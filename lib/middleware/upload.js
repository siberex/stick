/**
 * @fileOverview This module provides support for parsing multipart MIME messages
 * used for file uploads.
 *
 * This module behaves analogous and can be used in combination with the
 * [params][middleware/params] middleware.
 * 
 * @example
 *    var fileUpload = request.postParams['fooUpload'];
 *    var name = fileUpload.filename;
 *    // `filename` and `value` are user input and must be sanitized for security reasons.
 *    // Be strict about what you allow as `filename` (e.g.: only `A-Za-z\.` or simlar)
 *    fs.write(join(fooPath, name), fileUpload.value);
 */

const {isFileUpload, parseFileUpload, BufferFactory} = require("ringo/utils/http");

/**
 * Middleware factory to enable support for parsing file uploads.
 * @param {Function} next the wrapped middleware chain
 * @param {Object} app the Stick Application object
 * @returns {Function} a JSGI middleware function
 */
exports.middleware = function upload(next, app) {

    let streamFactory = BufferFactory;

    app.upload = function(factory) {
        streamFactory = factory;
    };

    return function upload(req) {

        let postParams, desc = Object.getOwnPropertyDescriptor(req, "postParams");

        /**
         * An object containing the parsed HTTP POST parameters sent with this request.
         * @name request.postParams
         */
        Object.defineProperty(req, "postParams", {
            get: function() {
                if (!postParams) {
                    const contentType = req.env.servletRequest.getContentType();
                    if ((req.method === "POST" || req.method === "PUT")
                            && isFileUpload(contentType)) {
                        postParams = {};
                        const encoding = req.env.servletRequest.getCharacterEncoding();
                        parseFileUpload(this, postParams, encoding, streamFactory);
                    } else if (desc) {
                        postParams = desc.get ? desc.get.apply(req) : desc.value;
                    }
                }
                return postParams;
            }, configurable: true
        });

        return next(req);
    };

};
