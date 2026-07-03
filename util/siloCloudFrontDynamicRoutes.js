/** cloudfront-js-2.0 — S3 directory indexes for Next.js static export (trailingSlash). */
export const SILO_CLOUDFRONT_DYNAMIC_ROUTES_FUNCTION_NAME = 'finnep-silo-event-shell-routes'

export const SILO_CLOUDFRONT_DYNAMIC_ROUTES_SOURCE = `function handler(event) {
  var request = event.request
  var uri = request.uri

  if (uri.indexOf('/_next/') === 0) {
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
