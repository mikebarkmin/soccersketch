# SoccerSketch

![logo](https://github.com/mikebarkmin/soccersketch/raw/master/logo.png)

**A progressive web app to create and manage soccer drills.**

[![Contributors](https://img.shields.io/github/contributors/mikebarkmin/soccersketch.svg "Contributors")](https://github.com/mikebarkmin/soccersketch/graphs/contributors)
[![Docker Cloud container status](https://img.shields.io/docker/cloud/build/mikebarkmin/soccersketch.svg "Docker Cloud container status")](https://hub.docker.com/r/mikebarkmin/soccersketch)
[![Docker Pulls](https://img.shields.io/docker/pulls/mikebarkmin/soccersketch)](https://cloud.docker.com/repository/docker/mikebarkmin/soccersketch)
[![Maintainability](https://api.codeclimate.com/v1/badges/ac5730932862bc3cfa78/maintainability)](https://codeclimate.com/github/mikebarkmin/soccersketch/maintainability)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fmikebarkmin%2Fsoccersketch.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fmikebarkmin%2Fsoccersketch?ref=badge_shield)

## Translations

[:de:](https://raw.githubusercontent.com/mikebarkmin/soccersketch/master/client/src/locales/de-DE/messages.po) [:fr:](https://raw.githubusercontent.com/mikebarkmin/soccersketch/master/client/src/locales/fr/messages.po) [:us:](https://raw.githubusercontent.com/mikebarkmin/soccersketch/master/client/src/locales/en-US/messages.po)

To correct a translation simply edit the corresponding message.po file.

To add a new language you can do this:

```
Fork https://github.com/mikebarkmin/soccersketch.git
git clone https://github.com/{your_username}/soccersketch.git
cd soccersketch.git
git checkout -b languages/{languagecode}
yarn install
yarn locale:add {languagecode}
yarn locale:extract
Edit client/src/locale/{languagecode}/messages.po
yarn locale:compile
Submit a pull request
```

## [Feature Requests and Bugs](https://github.com/mikebarkmin/soccersketch/issues)

Please add your questions as GitHub issue: [soccersketch Feature Requests and Bugs](https://github.com/mikebarkmin/soccersketch/issues).

## Develop

```
Fork https://github.com/mikebarkmin/soccersketch.git
git clone https://github.com/{yourusername}/soccersketch.git
cd soccersketch
docker-compose up
Submit a pull request
```

## Deploy

```
wget https://github.com/mikebarkmin/soccersketch/raw/master/docker-compose.prod.yml
wget https://github.com/mikebarkmin/soccersketch/raw/master/mongo-init.js
Change username and password to something other than server/test
docker-compose -f docker-compose.prod.yml up
Visit localhost:8080
```

## License

Licensed under the MIT License, Copyright © 2019-present Mike Barkmin.

See [LICENSE](https://raw.githubusercontent.com/mikebarkmin/soccersketch/master/LICENSE) for more information.
