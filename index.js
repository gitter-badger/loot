var http = require('http')
var https = require('https')
var url = require('url')
var trumpet = require('trumpet')
var mkdirp = require('mkdirp')
var fs = require('fs')
var sanitize = require('sanitize-filename')

var router = new (require('routes'))

mkdirp('./cache', function (err) {
  if (err) throw err
  http.createServer((req, res) => {
    var path = url.parse(req.url).pathname
    var match = router.match(path)
    if (match) match.fn(req, res, match)
    else { res.statusCode = 404; res.end('nope') }
  }).listen(7001)
})

function error (res, e) {
  res.statusCode = 500
  res.end(e.message)
}

var restbase = 'https://en.wikipedia.org/api/rest_v1'
function getRestbaseHtml (title) {
  return new Promise((resolve, reject) =>
    https.get(`${restbase}/page/html/${title}`, (res) => resolve(res))
      .on('error', (e) => reject(e)))
}

function cacheFolder (url) { return `./cache/${sanitize(url)}` }
function cacheUrl (url, title) { return `./cache/${sanitize(url)}/${sanitize(title)}.html` }

function restbaseReqHandler (transform) {
  return function (req, res, match) {
    var title = match.params.title
    var cache = cacheUrl(match.route, title)

    // Check cache
    mkdirp(cacheFolder(match.route), function (err) {
      if (err) throw err
      fs.stat(cache, function (err, stats) {
        // Cache miss
        if (err) {
          getRestbaseHtml(title)
            .then((restRes) => {
              var transformed = transform ? transform(restRes) : restRes
              transformed.pipe(res)
              transformed.pipe(fs.createWriteStream(cache))
            })
            .catch((e) => error(res, e))
        } else {
          fs.createReadStream(cache).pipe(res)
        }
      })
    })
  }
}

router.addRoute('/raw/:title', restbaseReqHandler())
router.addRoute('/noimages/:title', restbaseReqHandler(noimages))
router.addRoute('/slim/:title', restbaseReqHandler(slim))

function noimages (res) {
  var stream = trumpet()
  removeImages(stream)
  removeStyles(stream)
  res.pipe(stream)
  return stream
}

function slim (res) {
  var stream = trumpet()
  removeImages(stream)
  removeTables(stream)
  removeDataMW(stream)
  removeStyles(stream)
  removeReferences(stream);
  res.pipe(stream)
  return stream
}

function removeAll (stream, selector) {
  stream.selectAll(selector, (el) => el.createWriteStream({ outer: true }).end(''))
}

function removeImages (s) { removeAll(s, 'img') }
function removeTables (s) { removeAll(s, 'table') }
function removeReferences (s) { removeAll(s, '[typeof="mw:Extension/references"]') }

function removeStyles (s) {
  removeAll(s, 'link[rel=stylesheet]')
  removeAll(s, 'style')
}

function removeDataMW (s) {
  s.selectAll('[data-mw]', (el) => el.removeAttribute('data-mw'))
}
