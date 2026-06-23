/** cloudfront-js-2.0 — rewrite dynamic event URLs + S3 directory indexes for static export. */
export const SILO_CLOUDFRONT_DYNAMIC_ROUTES_FUNCTION_NAME = 'finnep-silo-event-shell-routes'

export const SILO_CLOUDFRONT_DYNAMIC_ROUTES_SOURCE = `function handler(event) {
  var request = event.request
  var uri = request.uri

  if (uri.indexOf('/_next/') === 0) {
    return request
  }

  var seatsMatch = uri.match(/^\\/events\\/([^/]+)\\/seats\\/?(index\\.html)?$/)
  if (seatsMatch && seatsMatch[1] !== 'shell' && seatsMatch[1] !== 'index.html') {
    request.uri = '/events/shell/seats/index.html'
    return request
  }

  var eventMatch = uri.match(/^\\/events\\/([^/]+)\\/?(index\\.html)?$/)
  if (eventMatch && eventMatch[1] !== 'shell' && eventMatch[1] !== 'index.html') {
    request.uri = '/events/shell/index.html'
    return request
  }

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html'
    return request
  }
  if (uri.indexOf('.') === -1) {
    request.uri = uri + '/index.html'
    return request
  }

  return request
}
`
