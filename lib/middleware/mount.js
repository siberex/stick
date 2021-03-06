/**
 * @fileOverview This module provides middleware for mounting other applications
 * on a specific URI path or virtual host.
 *
 * Applying this middleware adds a `mount` method to the application. The mount
 * method takes a path or virtual host specification and an application as arguments.
 * If the spec is a string, it is interpreted as the URI path on which the app will be
 * mounted. If it is an object, it may contain `path` or `host` properties
 * that will be matched against the URI path and `Host` header of incoming requests.
 * _Note that virtual host based mounting has not been tested so far._
 *
 * The `mount` method accepts an optional third boolean `noRedirect` argument.
 * If set to `true` it will disable redirecting GET requests to the mount base
 * URL without a trailing slash to the same URL with trailing slash. By default,
 * mount middleware will send a redirect to the mount URL with trailing slash.
 *
 * Mounting one application within another causes the `scriptName` and `pathInfo`
 * properties in the request object to be adjusted so that the mounted application
 * receives the same pathInfo as if it was the main application. This means
 * that forward and reverse request routing will usually work as expected.
 *
 * This middleware maintains an index mapping applications to mount points which
 * can be accessed using the [lookup](#lookup) function. The [stick/helpers][helpers]
 * module provides higher level functions for this which include support for the
 * route middleware.
 *
 * @example
 * app.configure("mount");
 * app.mount("/wiki", module.resolve("vendor/ringowiki"));
 */

const {Headers} = require("ringo/utils/http");
const {resolveApp} = require("../helpers");
const strings = require("ringo/utils/strings");

/**
 * Middleware to mount other application on specific URI paths or virtual hosts.
 * @param {Function} next the wrapped middleware chain
 * @param {Object} app the Stick Application object
 * @returns {Function} a JSGI middleware function
 */
exports.middleware = function Mount(next, app) {

    const mounts = [];

    // define mount() method on application object
    app.mount = function(spec, target, noRedirect) {
        if (typeof spec === "string") {
            spec = {path: spec};
        } else if (!spec) {
            throw new Error("Missing spec");
        }
        if (spec.path) {
            // set up canonical path with trailing slash
            if (strings.endsWith(spec.path, "/")) {
                spec.canonicalPath = spec.path;
                spec.path = spec.path.slice(0, -1);
            } else {
                spec.canonicalPath = spec.path + "/";
            }
        }

        spec.host = spec.host ? String(spec.host) : null;
        const resolved = resolveApp(target);

        // add mount info to mounted app for reverse lookup
        if (!resolved.mountInfo) {
            resolved.mountInfo = [];
        }
        resolved.mountInfo.push({parent: app, path: spec.path, host: spec.host});

        mounts.push({
            match: function(req) {
                const host = req.headers.get("host") || "";
                const path = req.pathInfo || "/";

                return (!spec.host || (host && strings.endsWith(host, spec.host)))
                    && (!spec.path || path === spec.path
                                   || (path && strings.startsWith(path, spec.canonicalPath)));
            },
            path: spec.path,
            canonicalPath: spec.canonicalPath,
            redirect: !noRedirect,
            app: resolved
        });
        mounts.sort(mostSpecificPathFirst);
    };

    /**
     * Sort the mounts array by the most specific mount path first. This means the mount path with
     * the most slashes in it will be searched first.
     *
     * @param m1 mount 1
     * @param m2 mount 2
     */
    function mostSpecificPathFirst(m1, m2) {
        let slash1 = (m1.path || '').match(/\//g);
        slash1 = slash1 == null ? 0 : slash1.length;
        let slash2 = (m2.path || '').match(/\//g);
        slash2 = slash2 == null ? 0 : slash2.length;
        return slash2 - slash1;
    }

    // return middleware function
    return function mount(req) {

        Headers(req.headers);
        for (let i = 0, length = mounts.length; i < length; i++) {
            let mount = mounts[i];
            if (mount.match(req)) {

                // if trailing slash is missing redirect to canonical path
                if (mount.redirect && req.pathInfo === mount.path && req.method === "GET") {
                    let location = req.scriptName + mount.canonicalPath;
                    if (req.queryString) location += "?" + req.queryString;
                    return {
                        status: 303,
                        headers: { "location": location},
                        body: ["See other: ", location]
                    }
                }

                // adjust scriptName and pathInfo
                if (mount.path) {
                    req.scriptName += mount.path;
                    req.pathInfo = req.pathInfo.slice(mount.path.length);
                }
                return mount.app(req);
            }
        }
        return next(req);
    };
};

/**
 * Return the URI path of a mounted application 
 * @param target a mounted JSGI application
 * @returns the URI path of the application, or ""
 */
exports.lookup = function(target) {
    const resolved = resolveApp(target);
    if (!Array.isArray(resolved.mountInfo)) {
        return "";
    }
    let mounts = resolved.mountInfo,
        seen = [resolved],
        path = "";

    outer:
    while (mounts) {
        for (let i = 0; i < mounts.length; i++) {
            let mount = mounts[i];
            // currently the only way to recognize a root application is by
            // absence of mount infos. We might want to introduce some root flag.
            if (mount.parent && seen.indexOf(mount.parent) === -1) {
                seen.push(mount.parent);
                path = (mount.path || "") + path;
                mounts = mount.parent.mountInfo;
                continue outer;
            }
        }
        mounts = null;
    }
    return path;
};
