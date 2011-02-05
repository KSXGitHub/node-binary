var Chainsaw = require('chainsaw');
var EventEmitter = require('events').EventEmitter;
var Buffers = require('./lib/buffers.js');
var Vars = require('./lib/vars.js');

exports = module.exports = function (bufOrEm, eventName) {
    if (Buffer.isBuffer(bufOrEm)) {
        return exports.parse(bufOrEm);
    }
    else {
        return exports.stream(bufOrEm, eventName);
    }
};

exports.put = require('put');

exports.stream = function (em, eventName) {
    if (eventName === undefined) eventName = 'data';
    
    var pending = null;
    function getBytes (bytes, cb, skip) {
        pending = {
            bytes : bytes,
            skip : skip,
            cb : function (buf) {
                pending = null;
                cb(buf);
            },
        };
        dispatch();
    }
    
    var buffers = Buffers();
    em.on(eventName, function (buf) {
        buffers.push(buf);
        dispatch();
    });
    
    function dispatch () {
        if (!pending) return;
        var bytes = pending.bytes;
        
        if (buffers.ready >= bytes) {
            if (pending.skip) {
                pending.cb();
            }
            else {
                pending.cb(buffers.slice(0, bytes));
            }
            buffers.seek(bytes);
        }
    }
    
    var vars = Vars();
    
    var done = false;
    em.on('end', function () { done = true });
    
    return Chainsaw(function builder (saw) {
        function next () { if (!done) saw.next() }
        
        var self = words(function (bytes, cb) {
            return function (name) {
                getBytes(bytes, function (buf) {
                    vars.set(name, cb(buf));
                    next();
                });
            };
        });
        
        self.tap = function (cb) {
            saw.nest(cb, vars.store);
        };
        
        self.flush = function () {
            vars.store = {};
            next();
        };
        
        self.loop = function loop (cb) {
            var end = false;
            
            var s = Chainsaw.saw(builder, {});
            s.on('end', function () {
                if (!end) self.loop(cb)
            });
            
            var r = builder.call(s.handlers, s);
            if (r !== undefined) s.handlers = r;
            
            var ch = s.chain();
            cb.call(ch, function () {
                end = true;
                next();
            }, vars.store);
        };
        
        self.buffer = function (name, bytes) {
            if (typeof bytes === 'string') {
                bytes = vars.get(bytes);
            }
            
            getBytes(bytes, function (buf) {
                vars.set(name, buf);
                next();
            });
        };
        
        self.skip = function (bytes) {
            if (typeof bytes === 'string') {
                bytes = vars.get(bytes);
            }
            
            getBytes(bytes, function () {
                next();
            });
        };
        
        var findLast = null;
        self.find = function find (search, cb) {
            if (findLast === null) {
                getBytes(search.length, function (buf) {
                    for (
                        var i = 0;
                        i < search.length && search[i] === buf[i];
                        i++
                    );
                    if (i === search.length) {
                        if (cb) cb(new Buffer([]))
                    }
                });
            }
            else {
                for (var i = findLast.length; until[i] === buf[i]; i--);
                var span = findLast.length - i;
                console.log(span);
            }
        };
        
        return self;
    });
};

exports.parse = function parse (buffer) {
    var self = words(function (bytes, cb) {
        return function (name) {
            var buf = buffer.slice(offset, offset + bytes);
            offset += bytes;
            vars.set(name, cb(buf));
            return self;
        };
    });
    
    var offset = 0;
    var vars = Vars();
    self.vars = vars.store;
    
    self.tap = function (cb) {
        cb.call(self, vars.store);
        return self;
    };
    
    self.loop = function (cb) {
        var end = false;
        var ender = function () { end = true };
        while (end === false) {
            cb.call(self, ender, vars.store);
        }
        return self;
    };
    
    self.buffer = function (name, size) {
        if (typeof size === 'string') {
            size = vars.get(size);
        }
        var buf = buffer.slice(offset, offset + size);
        offset += size;
        vars.set(name, buf);
        
        return self;
    };
    
    self.flush = function () {
        vars.store = {};
        return self;
    };
    
    return self;
};

// convert byte strings to unsigned little endian numbers
function decodeLEu (bytes) {
    var acc = 0;
    for (var i = 0; i < bytes.length; i++) {
        acc += Math.pow(256,i) * bytes[i];
    }
    return acc;
}

// convert byte strings to unsigned big endian numbers
function decodeBEu (bytes) {
    var acc = 0;
    for (var i = 0; i < bytes.length; i++) {
        acc += Math.pow(256, bytes.length - i - 1) * bytes[i];
    }
    return acc;
}

// convert byte strings to signed big endian numbers
function decodeBEs (bytes) {
    var val = decodeBEu(bytes);
    if ((bytes[0] & 0x80) == 0x80) {
        val -= Math.pow(256, bytes.length);
    }
    return val;
}

// convert byte strings to signed little endian numbers
function decodeLEs (bytes) {
    var val = decodeLEu(bytes);
    if ((bytes[bytes.length - 1] & 0x80) == 0x80) {
        val -= Math.pow(256, bytes.length);
    }
    return val;
}

function words (decode) {
    var self = {};
    
    [ 1, 2, 4, 8 ].forEach(function (bytes) {
        var bits = bytes * 8;
        
        self['word' + bits + 'le']
        = self['word' + bits + 'lu']
        = decode(bytes, decodeLEu);
        
        self['word' + bits + 'ls']
        = decode(bytes, decodeLEs);
        
        self['word' + bits + 'be']
        = self['word' + bits + 'bu']
        = decode(bytes, decodeBEu);
        
        self['word' + bits + 'bs']
        = decode(bytes, decodeBEs);
    });
    
    // word8be(n) == word8le(n) for all n
    self.word8 = self.word8u = self.word8be;
    self.word8s = self.word8bs;
    
    return self;
}
