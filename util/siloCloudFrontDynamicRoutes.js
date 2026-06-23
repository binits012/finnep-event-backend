/** cloudfront-js-2.0 — rewrite dynamic event URLs to static shell HTML on S3. */
export const SILO_CLOUDFRONT_DYNAMIC_ROUTES_FUNCTION_NAME = 'finnep-silo-event-shell-routes'

export const SILO_CLOUDFRONT_DYNAMIC_ROUTES_SOURCE = `function handler(event) {
  var request = event.request
  var uri = request.uri

  if (uri.indexOf('/_next/') === 0) {
    return request
  }

  var seatsMatch = uri.match(/^\\/events\\/([^/]+)\\/seats\\/?(index\\.html)?$/)
  if (seatsMatch && seatsMatch[1] !== 'shell') {
    request.uri = '/events/shell/seats/index.html'
    return request
  }

  var eventMatch = uri.match(/^\\/events\\/([^/]+)\\/?(index\\.html)?$/)
  if (eventMatch && eventMatch[1] !== 'shell') {
    request.uri = '/events/shell/index.html'
    return request
  }

  return request
}
`
