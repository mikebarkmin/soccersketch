import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import connectDB from './database';

// Constants
const PORT = 8080;
const HOST = '0.0.0.0';

// App
const app = express();
const server = http.createServer(app);
connectDB();

app.use(cors());
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client')));
}

server.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);

if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, `client/index.html`));
  });
}
