'use strict';

const logger = {
    debug: require('debug')('magnet-to-torrent:main'),
    error: require('debug')('magnet-to-torrent:error'),
};

const mguri = require('magnet-uri');
const needle = require('needle');
const Promise = require('bluebird');
const isFunction = require('lodash/isFunction');
const validator = require('validator');

const service = {};

const servUrl = [
    function(hash) {
        return `http://btcache.me/torrent/${hash}`;
    },
    function(hash) {
        return `http://bt.box.n0808.com/${hash.slice(0, 2)}/${hash.slice(-2)}/${hash}.torrent`;
    },
    function(hash) {
        return `http://torcache.net/torrent/${hash}.torrent`;
    },
    function(hash) {
        return `https://torrage.com/torrent/${hash}.torrent`;
    }
];

var parseInfoHash = function(uri) {
    if(uri){
        const uriObj = mguri.decode(uri);
        const hash = uriObj.infoHash || uri;
        if (/^[A-Za-z0-9]{40}$/.test(hash)) {
            return hash.toUpperCase();
        }
    }
};
service.isMagnet = function(uri) {
    return !!parseInfoHash(uri);
};
service.addService = function(serv, pushToFront) {
    if(isFunction(serv)){
        !pushToFront ? servUrl.push(serv) : servUrl.unshift(serv);
        logger.debug('Magnet conversion service added to stack!');
    }else{
        logger.debug('Magnet conversion service not added!');
    }
};

var verifyTorrent = function(url) {
    const options = { follow_max: 3, open_timeout: 4000, read_timeout: 4000 };
    return needle('head', url, options).then((response) => {
        if (!(response.statusCode >= 200 && response.statusCode < 300)) {
            const err = new Error(`Error response: ${response.statusCode}`);
            logger.error(err);
            return Promise.reject(err);
        }

        const ct = response.headers && (response.headers['content-type'] || '');
        if (ct === 'application/octet-stream' ||
            ct === 'application/x-bittorrent' ||
            ct.indexOf('torrent') !== -1) {
            return url;
        } else {
            const err = new Error(`Invalid content type: ${ct}`);
            logger.error(err);
            return Promise.reject(err);
        }
    });
};

service.getLink = function(uri) {
    const hash = parseInfoHash(uri);
    if (!hash) {
        const err = new Error('Invalid magnet uri or info hash.');
        logger.error(err);
        return Promise.reject(err);
    }

    const urls = servUrl
        .map((fn) => fn(hash))
        .filter((u) => validator.isURL(u));

    let resolved = false;
    return new Promise((resolve, reject) => {
        const attempt = verifyTorrent.bind(null);
        const promises = urls.map((u) =>
            attempt(u).then((okUrl) => {
                if (!resolved) {
                    resolved = true;
                    resolve(okUrl);
                }
                return okUrl;
            }).catch(() => null)
        );

        Promise.all(promises).then((results) => {
            if (!resolved) {
                reject(new Error('Could not convert magnet link. All services tried.'));
            }
        });
    });
};

module.exports = service;
