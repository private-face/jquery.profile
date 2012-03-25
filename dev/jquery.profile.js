(function($) {

    /* Consts */
    var HAS_CONSOLE = window.console;
    var IS_FIREBUG = HAS_CONSOLE && (window.console.firebug || window.console.exception);
    var NAME = 30, TIME = 10, CALLS = 10;

    /* Safe console methods */
    var consoleMethods = ['log', 'warn', 'info', 'group', 'groupCollapsed', 'groupEnd', 'table'];
    var log = function() {
        return log.log.apply(this, arguments);
    };

    for(var i = 0; i < consoleMethods.length; ++i) {
        (function(name) {
            log[name] = function() {
                if (window.console && console[name]) {
                    return console[name].apply(console, arguments);
                }
            };
        })(consoleMethods[i]);
    }

    /* Profle */
    var Profiler = function(options) {
        if (Profiler.__instance) {
            return Profiler.__instance
        }
        Profiler.__instance = this;

        this._init(options);
    };

    Profiler.prototype = {
        constructor: Profiler,
        _EXCLUDE_FN: ['constructor', 'init', 'ready', 'push', 'sort', 'splice'], // to be contunued...
        _EXCLUDE_$: ['ready'],
        _DEFAULTS: {
            exclude: [],
            accumulateStats: false,
            showZeroTimeCallers: false,
            showZeroTimeFunctions: false
        },
        _init: function(options) {
            this._options = $.extend({}, this._DEFAULTS, options);
            this.data = {};
            this._currentFn = null;
            this._startTime = null;

            // wrap jQuery init
            this._wrapjQueryInit();

            // wrap $.fn.*
            for (var name in $.fn) {
                if ($.fn.hasOwnProperty(name) && typeof $.fn[name] === 'function' 
                    // init and constructor must not be wrapped
                    && $.inArray(name, this._EXCLUDE_FN) === -1
                    // do not wrap functions marked as 'excluded'
                    && $.inArray(name, this._options.exclude) === -1
                    // do not wrap private jQuery methods
                    && name.indexOf('_') !== 0
                    ) {
                    this.wrapFn($.fn, name, '$.fn.' + name);
                }
            }

            // wrap $.*
            for (var name in $) {
                if ($.hasOwnProperty(name) && typeof $[name] === 'function' 
                    // init and constructor must not be wrapped
                    && $.inArray(name, this._EXCLUDE_$) === -1
                    // do not wrap functions marked as 'excluded'
                    && $.inArray(name, this._options.exclude) === -1
                    // exclude constructors and private jQuery methods
                    && !name.match(/[A-Z_]/)
                    ) {
                    this.wrapFn($, name, '$.' + name);
                }
            }

            // set renderer
            this._render = HAS_CONSOLE ? (IS_FIREBUG ? this._ffRenderer : this._regularRenderer) : $.noop; // TODO: no console renderer
        },
        _getjQName: function(selector) {
            var name = 'wrapper',
                quickExpr = /^(?:[^#<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,
                match;
            switch (typeof selector) {
                case 'function': name = 'ready';
                                 break;
                case 'string': match = quickExpr.exec(selector);
                               name = match && match[1] ? 'html' : 'selector';
                               break;
                default: name = 'wrapper';
            }
            return '$(' + name + ')';
        },
        _copyOwnProps: function(dest, source) {
            for(var name in source)
                if (source.hasOwnProperty(name))
                    dest[name] = source[name];
        },
        _startFunctionTracking: function(globalName, oldFn, caller) {
            var data;

            this._lastCaller = caller;      // remember the caller
            this._currentFn = globalName;   

            data = this.data[globalName];
            if (!data) {
                data = this.data[globalName] = {
                    fn: oldFn,
                    calls: 0,
                    time: 0,
                    callers: []
                };
            }

            data.calls++;

            this._startTime = new Date;
        },
        _stopFunctionTracking: function() {
            var data, time;
            if (this._startTime && this._currentFn) {
                time = new Date - this._startTime;
                data = this.data[this._currentFn];
                data.time += time;
                data.callers.push({
                    time: time,
                    fn: this._lastCaller
                });

                this._startTime = null;
            }
            this._lastCaller = null;
            this._currentFn = null;
        },
        _wrapjQueryInit: function() {
            var oldInit = $.fn.init,
                self = this;

            var rootjQuery = $(document);
            $.fn.init = function init( selector, context ) {
                var res, time, name;
                // TODO: DRY!
                if (self._started && self._currentFn === null) {
                    name = self._getjQName(selector);
                    self._startFunctionTracking(name, oldInit, selector);
                    res = oldInit.call( this, selector, context, rootjQuery );
                    self._stopFunctionTracking(name);
                    
                } else {
                    res = oldInit.call( this, selector, context, rootjQuery );
                }

                return res;
            };
            $.fn.init.prototype = $.fn;
        },
        wrapFn: function(parentObj, name, globalName) {
            var self = this, 
                oldFn = parentObj[name];

            var newFn = function() {
                var res, time;
                // TODO: DRY!
                if (self._started && self._currentFn === null) {
                    self._startFunctionTracking(globalName, oldFn, arguments.callee.caller);
                    res = oldFn.apply(this, arguments);
                    self._stopFunctionTracking(globalName);
                } else {
                    res = oldFn.apply(this, arguments);
                }

                return res;
            }

            parentObj[name] = newFn;

            // copy prototype (in case of oldFn was a constructor)
            newFn.prototype = oldFn.prototype;

            // copy own properties
            this._copyOwnProps(parentObj[name], oldFn);
        },
        _formatStr: function(s, n) {
            return ('' + s + Array(n).join(' ')).substr(0, n);
        },
        _generateHeader: function(total, isFF) {
            var f = this._formatStr;
            var preSpaces = isFF ? ' ' : '  ';
            return '[Profilerr] Total profiled jQuery time: ' + total + 'ms' + 
                   '\n' + preSpaces + f("Name", NAME) + f("Time", TIME) + f('Calls', CALLS) + (isFF ? 'Top callers' : '');
        },
        _ffRenderer: function(a) {
            var f = this._formatStr;
            var groupLabel = this._generateHeader(a.total, true);
            var callersSpacer = Array(NAME + TIME + CALLS + 2).join(' ');

            log.group(groupLabel);
            for(var i = 0, l = a.length; i < l; ++i) {
                var str = [f(a[i].name, NAME), f(a[i].time + 'ms', TIME), f(a[i].calls, CALLS)];
                for (var j = 0, k = a[i].callers.length; j < k; ++j) {
                    if (j !== 0) {
                        str.push(callersSpacer);
                    }
                    str.push(f(a[i].callers[j].time + 'ms', TIME), a[i].callers[j].fn);
                    if (j !== k) {
                        str.push('\n');
                    }
                }
                log.apply(this, str);
            }
            log.groupEnd(groupLabel);
        },
        _regularRenderer: function(a) {
            var f = this._formatStr;
            var groupLabel = this._generateHeader(a.total);

            log.group(groupLabel);
            for(var i = 0, l = a.length; i < l; ++i) {
                var str = f(a[i].name, NAME) + f(a[i].time + 'ms', TIME) + f(a[i].calls, CALLS);
                log.groupCollapsed(str);
                for (var j = 0, k = a[i].callers.length; j < k; ++j) {
                    var callerStr = f(a[i].callers[j].time + 'ms', TIME) + a[i].callers[j].fn.toString().replace(/\n.*/gm, '').substr(0, 40);
                    log.groupCollapsed(callerStr);
                    log(a[i].callers[j].fn);
                    log.groupEnd(callerStr);
                }
                log.groupEnd(str);
            }
            log.groupEnd(groupLabel);
        },
        _statsToArray: function(compFunction) {
            var res = [];
            res.total = 0;
            for (var name in this.data) {
                // do not show functions which took 0 ms
                if (!this._options.showZeroTimeFunctions && this.data[name].time === 0) {
                    continue;
                }

                // remove repetitions
                var callers = this.data[name].callers.sort(function(a, b) { return b.time - a.time }),
                    callersSorted = [];

                for(var i = 0, l = callers.length; i < l; ++i) {
                    var fn = callers[i].fn;
                    var time = callers[i].time;

                    // do not show callers which took less than 
                    if (!this._options.showZeroTimeCallers && time === 0) {
                        break;
                    }

                    for(var j = 0, k = callersSorted.length; j < k; ++j) {
                        if (callersSorted[j].fn === fn) {
                            break;
                        }
                    }
                    if (j < k) {
                        callersSorted[j].time += time;
                    } else {
                        callersSorted.push(callers[i]);
                    }
                }

                res.push({
                    name: name,
                    time: this.data[name].time,
                    calls: this.data[name].calls,
                    callers: callersSorted
                });

                res.total += this.data[name].time;
            }

            if (typeof compFunction === 'function') {
                res = res.sort(compFunction);
            }

            return res;
        },
        start: function() {
            if (!this._started) {
                this._started = true;
                this._currentFn = null;
                if (!this._options.accumulateStats) {
                    this.data = {};
                }
            }
        },
        stop: function() {
            this._stopFunctionTracking();
            this._started = false;
        },
        topTime: function() {
            this._render(this._statsToArray(function(b, a) {
                return a.time - b.time
            }));
        },
        topCalls: function() {
            this._render(this._statsToArray(function(b, a) {
                return a.calls - b.calls
            }));
        }
    };

    $.Profiler = Profiler;

})(jQuery);