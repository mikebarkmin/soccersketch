#!/usr/bin/env python3
"""Convert the project's XFL vector library into an offline JavaScript catalog.

Run from any directory with Python 3. No third-party packages are required.
XFL edges are in twips (20 units per pixel); hex values use 24.8 fixed point.
"""
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
import html
import json
import re
import base64
import hashlib
import struct
import zlib
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
NS = {'x': 'http://ns.adobe.com/xfl/2008/'}
TOKEN = re.compile(r'#[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]+)?|-?\d+(?:\.\d+)?|[!|/\[\]]|S\d+')
MEDIA = {e.get('name'): e for e in ET.parse(ROOT/'DOMDocument.xml').getroot().findall('x:media/x:DOMBitmapItem', NS)}


@lru_cache(maxsize=None)
def bitmap(name):
    metadata = MEDIA.get(name)
    if metadata is None:
        raise ValueError(f'Missing bitmap metadata: {name}')
    data = (ROOT/'bin'/metadata.get('bitmapDataHRef')).read_bytes()
    width = round(float(metadata.get('frameRight')) / 20)
    height = round(float(metadata.get('frameBottom')) / 20)
    if data.startswith(b'\xff\xd8'):
        mime = 'image/jpeg'
    elif data[:2] == b'\x03\x05':
        # XFL's lossless DAT stores a zlib stream in length-prefixed chunks.
        chunks, offset = [], 26
        while offset < len(data):
            length = struct.unpack_from('<H', data, offset)[0]
            offset += 2
            if not length:
                break
            chunks.append(data[offset:offset+length])
            offset += length
        pixels = zlib.decompress(b''.join(chunks))
        stride = struct.unpack_from('<H', data, 2)[0]
        rows = []
        for y in range(height):
            row = bytearray([0])  # PNG filter: none.
            for x in range(width):
                alpha, red, green, blue = pixels[y*stride+x*4:y*stride+x*4+4]
                if 0 < alpha < 255:
                    red, green, blue = [min(255, round(c*255/alpha)) for c in (red, green, blue)]
                row.extend((red, green, blue, alpha))
            rows.append(bytes(row))
        def chunk(tag, payload):
            return struct.pack('>I', len(payload))+tag+payload+struct.pack('>I', zlib.crc32(tag+payload)&0xffffffff)
        data = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))+chunk(b'IDAT', zlib.compress(b''.join(rows)))+chunk(b'IEND', b'')
        mime = 'image/png'
    else:
        raise ValueError(f'Unsupported bitmap data: {name}')
    return 'data:'+mime+';base64,'+base64.b64encode(data).decode(), width, height


def num(value):
    if value.startswith('#'):
        whole, _, fraction = value[1:].partition('.')
        integer = int(whole, 16)
        if integer >= 0x800000:
            integer -= 0x1000000
        return integer + (int(fraction, 16) / 16 ** len(fraction) if fraction else 0)
    return float(value)


def fmt(value):
    return f'{value:.4f}'.rstrip('0').rstrip('.') or '0'


def matrix(element):
    m = element.find('x:matrix/x:Matrix', NS)
    return tuple(float(m.get(k, d)) if m is not None else float(d)
                 for k, d in zip(('a', 'b', 'c', 'd', 'tx', 'ty'), ('1', '0', '0', '1', '0', '0')))


def transform(point, m):
    x, y = point
    a, b, c, d, tx, ty = m
    return a*x+c*y+tx, b*x+d*y+ty


def segments(value):
    tokens = TOKEN.findall(value)
    result, position, i = [], (0, 0), 0
    while i < len(tokens):
        command = tokens[i]
        i += 1
        if command.startswith('S'):
            continue  # Stroke selection flags in authoring metadata.
        if command == '!':
            position = (num(tokens[i])/20, num(tokens[i+1])/20)
            i += 2
        elif command in ('|', '/'):
            end = (num(tokens[i])/20, num(tokens[i+1])/20)
            result.append((position, end, None))
            position, i = end, i+2
        elif command in ('[', ']'):
            control = (num(tokens[i])/20, num(tokens[i+1])/20)
            end = (num(tokens[i+2])/20, num(tokens[i+3])/20)
            result.append((position, end, control))
            position, i = end, i+4
        else:
            raise ValueError(f'Unsupported XFL edge token: {command}')
    return result


def paths(edges, close):
    outgoing = defaultdict(list)
    for start, end, control in edges:
        outgoing[start].append((end, control))
    result = []
    while outgoing:
        start = next(iter(outgoing))
        current = start
        chain = ['M'+fmt(start[0])+' '+fmt(start[1])]
        while current in outgoing:
            end, control = outgoing[current].pop()
            if not outgoing[current]:
                del outgoing[current]
            if control is None:
                chain.append('L'+fmt(end[0])+' '+fmt(end[1]))
            else:
                chain.append('Q'+fmt(control[0])+' '+fmt(control[1])+' '+fmt(end[0])+' '+fmt(end[1]))
            current = end
            if current == start:
                break
        if close:
            chain.append('Z')
        result.append(''.join(chain))
    return ''.join(result)


def color(element):
    solid = element.find('.//x:SolidColor', NS)
    if solid is not None:
        return solid.get('color', '#000000'), solid.get('alpha', '1')
    return '#000000', '1'


def bounds(points):
    if not points:
        return [0, 0, 1, 1]
    xs, ys = zip(*points)
    return [min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys)]


def shape(element):
    fills, strokes, points = defaultdict(list), defaultdict(list), []
    for edge in element.findall('x:edges/x:Edge', NS):
        edges = segments(edge.get('edges', ''))
        for start, end, control in edges:
            points.extend((start, end))
            if control:
                points.append(control)
        f0, f1 = edge.get('fillStyle0'), edge.get('fillStyle1')
        if f0 != f1:
            if f0 and f0 != '0':
                fills[f0].extend(edges)
            if f1 and f1 != '0':
                fills[f1].extend((end, start, c) for start, end, c in edges)
        if edge.get('strokeStyle') not in (None, '0'):
            strokes[edge.get('strokeStyle')].extend(edges)
    parts = []
    for style in element.findall('x:fills/x:FillStyle', NS):
        index = style.get('index')
        if fills[index]:
            paint, alpha = color(style)
            bitmap_fill = style.find('x:BitmapFill', NS)
            if bitmap_fill is not None:
                uri, width, height = bitmap(bitmap_fill.get('bitmapPath'))
                m = list(matrix(bitmap_fill))
                m[:4] = [v/20 for v in m[:4]]
                ident = 'bitmap-'+hashlib.sha1(ET.tostring(bitmap_fill)).hexdigest()[:12]
                parts.append(f'<defs><pattern id="{ident}" width="{width}" height="{height}" patternUnits="userSpaceOnUse" patternTransform="matrix({" ".join(map(fmt,m))})"><image width="{width}" height="{height}" href="{uri}"/></pattern></defs>')
                paint = f'url(#{ident})'
            parts.append(f'<path d="{paths(fills[index], True)}" fill="{paint}" fill-opacity="{alpha}" fill-rule="nonzero"/>')
    for style in element.findall('x:strokes/x:StrokeStyle', NS):
        index = style.get('index')
        if strokes[index]:
            paint, alpha = color(style)
            solid = style.find('x:SolidStroke', NS)
            weight = solid.get('weight', '1') if solid is not None else '1'
            parts.append(f'<path d="{paths(strokes[index], False)}" fill="none" stroke="{paint}" stroke-opacity="{alpha}" stroke-width="{weight}" stroke-linecap="round" stroke-linejoin="round"/>')
    return ''.join(parts), points


def render_element(element, frame):
    tag = element.tag.split('}')[-1]
    parts, points = [], []
    if tag == 'DOMShape':
        markup, points = shape(element)
        parts.append(markup)
    elif tag == 'DOMGroup':
        for child in element.findall('x:members/*', NS):
            markup, child_points = render_element(child, frame)
            parts.append(markup)
            points.extend(child_points)
    elif tag == 'DOMSymbolInstance':
        markup, points = render_symbol(element.get('libraryItemName'), int(element.get('firstFrame', '0')))
        parts.append(markup)
    elif tag == 'DOMBitmapInstance':
        uri, width, height = bitmap(element.get('libraryItemName'))
        parts.append(f'<image width="{width}" height="{height}" href="{uri}"/>')
        points.extend(((0, 0), (width, 0), (0, height), (width, height)))
    elif tag in ('DOMStaticText', 'DOMDynamicText', 'DOMInputText'):
        for run in element.findall('x:textRuns/x:DOMTextRun', NS):
            attrs = run.find('x:textAttrs/x:DOMTextAttrs', NS)
            if attrs is None:
                continue
            size = float(attrs.get('size', '16'))
            text = run.findtext('x:characters', '', NS)
            paint = attrs.get('fillColor', '#000000')
            x = float(element.get('left', '0'))
            width = float(element.get('width', str(len(text)*size*.6)))
            alignment = attrs.get('alignment')
            if alignment == 'center':
                x += width/2
            anchor = 'middle' if alignment == 'center' else 'start'
            weight = 'bold' if 'Bold' in attrs.get('face', '') else 'normal'
            parts.append(f'<text x="{fmt(x)}" y="{fmt(size)}" font-family="Arial,sans-serif" font-size="{fmt(size)}" font-weight="{weight}" text-anchor="{anchor}" fill="{paint}">{html.escape(text)}</text>')
            points.extend(((float(element.get('left', '0')), 0), (float(element.get('left', '0'))+width, size*1.2)))
    m = matrix(element)
    points = [transform(p, m) for p in points]
    markup = ''.join(parts)
    if m != (1., 0., 0., 1., 0., 0.) and markup:
        markup = '<g transform="matrix('+ ' '.join(map(fmt, m)) + ')">'+markup+'</g>'
    return markup, points


@lru_cache(maxsize=None)
def symbol(name):
    path = ROOT/'LIBRARY'/f'{name}.xml'
    return ET.parse(path).getroot() if path.exists() else None


@lru_cache(maxsize=None)
def render_symbol(name, frame):
    root = symbol(name)
    if root is None:
        return '', []
    parts, points = [], []
    layers = root.findall('x:timeline/x:DOMTimeline/x:layers/x:DOMLayer', NS)
    for layer in reversed(layers):
        if layer.get('layerType') in ('guide', 'folder'):
            continue
        for f in layer.findall('x:frames/x:DOMFrame', NS):
            start = int(f.get('index', '0'))
            if start <= frame < start+int(f.get('duration', '1')):
                for e in f.findall('x:elements/*', NS):
                    markup, child_points = render_element(e, frame)
                    parts.append(markup)
                    points.extend(child_points)
    return ''.join(parts), points


GROUPS = {'Stehen': 'Standing', 'Dribbling': 'Dribbling', 'Passen': 'Passing',
          'Schuss': 'Shooting', 'Tackling': 'Tackling', 'Kopfball': 'Heading',
          'Ruecken': 'Back view', 'Torhüter': 'Goalkeepers', 'Number': 'Markers'}


def main():
    catalog = []
    for path in sorted((ROOT/'LIBRARY').rglob('*.xml')):
        relative = path.relative_to(ROOT/'LIBRARY')
        folder = relative.parts[0]
        if folder not in ('Spieler', 'Materialien', 'Halle'):
            continue
        root = ET.parse(path).getroot()
        name = root.get('name')
        max_frame = max(int(f.get('index', '0'))+int(f.get('duration', '1')) for f in root.findall('.//x:DOMFrame', NS))
        variants = []
        for frame in range(max_frame):
            markup, points = render_symbol(name, frame)
            variants.append({'svg': markup, 'bounds': [round(v, 4) for v in bounds(points)]})
        group = GROUPS[relative.parts[1]] if folder == 'Spieler' else ('Indoor' if folder == 'Halle' else 'Equipment')
        stem = path.stem
        if folder == 'Spieler':
            label = ('Number ' if stem.startswith('number_') else group+' ')+stem.split('_')[-1]
        else:
            label = stem.replace('materialien_', '').replace('matrialien_', '').replace('_', ' ').replace('hüchten', 'Cone').replace('hütchen flach', 'Flat cone').replace('tor', 'Goal').replace('stange', 'Pole').replace('leiter', 'Ladder').replace('hürde', 'Hurdle').replace('ring', 'Ring').replace('ball', 'Ball').replace('kasten', 'Vault').replace('matte groß', 'Mat').replace('bank', 'Bench').replace('kiste', 'Box')
        catalog.append({'id': root.get('linkageClassName', name), 'name': name, 'label': label,
                        'category': group, 'variants': variants})
    pitches = []
    for frame in range(10):
        markup, points = render_symbol('Spielfelder/mc_spielfeld1', frame)
        pitches.append({'svg': markup, 'bounds': [round(v, 4) for v in bounds(points)]})
    ui = {}
    for name in ['skins/IconHelp', 'skins/CustomDeleteControl', 'skins/reset', 'skins/CustomRotateControl']:
        markup, points = render_symbol(name, 0)
        key = {'skins/reset': 'CustomResetControl', 'skins/CustomRotateControl': 'CustomRotationControl'}.get(name, name.split('/')[-1])
        ui[key] = {'svg': markup, 'bounds': bounds(points)}
    data = {'assets': catalog, 'pitches': pitches, 'ui': ui}
    target = ROOT/'web/assets.js'
    target.write_text('// Generated by tools/export_assets.py from the original XFL library.\nwindow.SOCCER_ASSETS = '+json.dumps(data, ensure_ascii=False, separators=(',', ':'))+';\n')
    (ROOT/'web/assets').mkdir(exist_ok=True)
    shutil.copyfile(ROOT/'LIBRARY/light_bulb.png', ROOT/'web/assets/light_bulb.png')
    print(f'Exported {len(catalog)} assets, {sum(len(a["variants"]) for a in catalog)} variants, and {len(pitches)} pitches to {target.name} ({target.stat().st_size:,} bytes).')


if __name__ == '__main__':
    main()
