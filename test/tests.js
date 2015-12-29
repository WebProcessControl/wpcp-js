var WPCP_METHODS = [
  "browse", 1,
  "cancelcall", 0,
  "handlealarm", 1,
  "processed", 0,
  "progress", 0,
  "publish", 0,
  "readdata", 1,
  "readhistoryalarm", 1,
  "readhistorydata", 1,
  "result", 0,
  "subscribealarm", 4,
  "subscribeaudit", 2,
  "subscribedata", 3,
  "test", 1,
  "test1", 1,
  "test2", 1,
  "test3", 1,
  "test4", 1,
  "test5", 1,
  "test6", 1,
  "test7", 1,
  "test8", 1,
  "test9", 1,
  "test10", 1,
  "unsubscribe", 1,
  "writedata", 1
];

function testMe(name, fn) {
  test(name, function() {
    var ret = [];

    function DummyWebSocket(url, protocols) {
      this.closeCount = 0;
      this.passedUrl = url;
      this.passedProtocols = protocols;
      this.protocol = protocols[0];
      this.sentMessages = [];
      this.onopen = function() {};
      this.onmessage = function() {};
      this.onclose = function() {};
      ret.push(this);
    }

    DummyWebSocket.prototype.close = function(data) {
      ++this.closeCount;
    };

    DummyWebSocket.prototype.send = function(data) {
      this.sentMessages.push(data);
    };

    DummyWebSocket.prototype.popMessage = function(data) {
      deepEqual(CBOR.decode(this.sentMessages[0]), data);
      this.sentMessages = this.sentMessages.slice(1);
    };

    DummyWebSocket.prototype.pushMessage = function(data) {
      this.onmessage({data:CBOR.encode(data)});
    };

    WebSocket = DummyWebSocket;
    Object.prototype.dummy = 123;

    fn(ret);

    delete Object.prototype.dummy;
    delete WebSocket;

    ret.forEach(function(ws) {
      equal(ws.sentMessages.length, 0);
    });
  });
}

function TestHelper(wpcp, webSockets, methods) {
  this.wpcp = wpcp;
  this.webSockets = webSockets;
  this.publishId = 1;
  this.methods = methods;
}

TestHelper.prototype.getId = function(name) {
  for (var i = 0; i < this.methods.length; i += 2) {
    if (this.methods[i] === name)
      return i / 2;
  }
}

TestHelper.prototype.pushMessage = function(data) {
  this.webSockets[0].pushMessage(data);
};

TestHelper.prototype.publish = function() {
  var args = [0];
  for (var i = 0; i < arguments.length; ++i)
    args.push(arguments[i]);
  return this.publishAt.apply(this, args);
};

TestHelper.prototype.publishAt = function(at) {
  var self = this;
  var pid = this.publishId++;
  var data = [this.getId("publish"), pid];
  var ws = this.webSockets[at];

  for (var i = 1; i < arguments.length; ++i)
    data.push(arguments[i]);

  ws.pushMessage(data);

  var ret = function(at) {
    (at !== undefined ? self.webSockets[at] : ws).popMessage([self.getId("processed"), pid]);
  };
  ret.sn = pid;
  ret.againAt = function(at) {
    self.webSockets[at].pushMessage(data);
  };
  return ret;
};

TestHelper.prototype.req = function(name) {
  var args = [0];
  for (var i = 0; i < arguments.length; ++i)
    args.push(arguments[i]);
  return this.reqAt.apply(this, args);
};

TestHelper.prototype.reqAt = function(at, name) {
  var self = this;

  function mk(name, offset, args) {
    var ret = [self.getId(name), requestId];

    for (var i = offset; i < args.length; ++i)
      ret.push(args[i]);

    return ret;
  }

  var ws = self.webSockets[at];
  var recv = CBOR.decode(ws.sentMessages[0]);
  var messageId = recv[0];
  var requestId = recv[1];
  ws.sentMessages = ws.sentMessages.slice(1);
  deepEqual(recv, mk(name, 2, arguments));

  return {
    cancel: function() {
      ws.popMessage(mk("cancelcall", 0, []));
    },
    prg: function() {
      ws.pushMessage(mk("progress", 0, arguments));
    },
    prgAt: function(at) {
      self.webSockets[at].pushMessage(mk("progress", 1, arguments));
    },
    res: function() {
      ws.pushMessage(mk("result", 0, arguments));
    },
    resAt: function(at) {
      self.webSockets[at].pushMessage(mk("result", 1, arguments));
    },
    mid: messageId,
    sn: requestId
  };
};

TestHelper.prototype.tsAt = function(at, name, sn) {
  var self = this;
  var obj = name ? {head:[self.getId(name), sn]} : {};
  var r = this.reqAt(at, "transfersession", obj);
  var ret = function(req) {
    r.res(null, req ? {head:[req.mid, req.sn]} : {});
  };
  ret.sn = r.sn;
  return ret;
};

function testWpcp(name, fn) {
  testMe(name, function(webSockets) {
    equal(webSockets.length, 0);
    var wpcp = new Wpcp("url");
    var $ = new TestHelper(wpcp, webSockets, WPCP_METHODS);
    equal(webSockets.length, 1);
    equal(webSockets[0].passedUrl, "url");
    deepEqual(webSockets[0].passedProtocols, ["wpcp"]);
    equal(webSockets[0].binaryType, "arraybuffer");

    webSockets[0].onopen();
    webSockets[0].popMessage([0, 0, {}]);
    webSockets[0].pushMessage([$.getId("result"), 0, {"methods":WPCP_METHODS}]);

    fn($, wpcp);
    equal(webSockets[0].sentMessages.length, 0);
  });
}

function okFalse() {
  ok(false);
}

testMe("construct Wpcp without arguments", function() {
  throws(function() {
    new Wpcp();
  },
  /first parameter must be an array of strings/);
});

testMe("construct Wpcp with a number", function() {
  throws(function() {
    new Wpcp(123);
  },
  /first parameter must be an array of strings/);
});

testMe("startup", function(ws) {
  var newSessionsCount = 0;
  equal(ws.length, 0);
  var wpcp = new Wpcp(["url", "url2"]);
  var $ = new TestHelper(wpcp, ws, WPCP_METHODS);
  wpcp.onnewsession = function() {
    ++newSessionsCount;
  };
  wpcp.onsessionstatechange = function() {
  };
  equal(ws.length, 2);
  equal(ws[0].passedUrl, "url");
  deepEqual(ws[0].passedProtocols, ["wpcp"]);
  equal(ws[0].binaryType, "arraybuffer");
  equal(ws[1].passedUrl, "url2");
  deepEqual(ws[1].passedProtocols, ["wpcp"]);
  equal(ws[1].binaryType, "arraybuffer");

  ws[0].onopen();
  ws[0].popMessage([0, 0, {}]);
  equal(newSessionsCount, 0);
  ws[0].pushMessage([$.getId("result"), 0, {"methods":WPCP_METHODS}]);
  equal(newSessionsCount, 1);

  ws[1].onopen();
  equal(newSessionsCount, 1);
});

testMe("subscribeurls", function(ws) {
  var wpcp_hello_methods = [
    "publish", 0,
    "processed", 0,
    "subscribeurls", 3,
    "result", 0
  ];

  var wpcp = new Wpcp(["url"]);

  ws[0].onopen();
  ws[0].popMessage([0, 0, {}]);
  equal(ws.length, 1);
  equal(ws[0].passedUrl, "url");
  ws[0].pushMessage([3, 0, {"methods":wpcp_hello_methods, "sessionid":"SID"}]);
  ws[0].popMessage([2, 0, {}]);
  ws[0].pushMessage([3, 0, null, 1]);
  ws[0].pushMessage([0, 0, 1, [{"url": "url"}, {"url": "url2"}]]);
  ws[0].popMessage([1, 0]);
  equal(ws.length, 2);
  equal(ws[1].passedUrl, "url2");

  ws[0].pushMessage([0, 0, 1, [{"url": "url3"}, {"url": "url"}, {"url": "url2"}]]);
  ws[0].popMessage([1, 0]);
  equal(ws.length, 3);
  equal(ws[2].passedUrl, "url3");

  ws[0].pushMessage([0, 0, 1, [{"url": "url"}, {"url": "url3"}]]);
  ws[0].popMessage([1, 0]);

  equal(ws[1].closeCount, 1);
  ws[1].onclose();
});

testMe("setUrls", function(ws) {
  var wpcp_hello_methods = [
    "publish", 0,
    "processed", 0,
    "transfersession", 1,
    "result", 0
  ];

  var newSessionsCount = 0;
  var wpcp = new Wpcp(["url1", "url2"]);
  var $ = new TestHelper(wpcp, ws, wpcp_hello_methods);

  equal(ws[0].passedUrl, "url1");
  equal(ws[1].passedUrl, "url2");
  ws[0].onopen();
  ws[1].onopen();
  ws[0].popMessage([0, 0, {}]);
  ws[0].pushMessage([3, 0, {"methods":wpcp_hello_methods, "sessionid":"SID"}]);
  ws[1].popMessage([0, 0, {"sessionid":"SID"}]);
  ws[1].pushMessage([3, 0, {"sessionid":"SID"}]);

  wpcp.setUrls([{"url": "url2"}]);
  var r1 = $.tsAt(1);
  equal(ws[0].closeCount, 0);
  r1();
  equal(ws[0].closeCount, 1);
  ws[0].onclose();

  wpcp.setUrls([{"url": "url2"}, {"url": "url3"}]);
  equal(ws[2].passedUrl, "url3");
  ws[2].onopen();
  ws[2].popMessage([0, 0, {"sessionid":"SID"}]);
  ws[2].pushMessage([3, 0, {"sessionid":"SID"}]);

  wpcp.setUrls([{"url": "url2"}, {"priority": 1, "url": "url3"}]);
  var r2 = $.tsAt(2);
  r2();

  wpcp.setUrls([{"priority": 2, "url": "url2"}, {"priority": 1, "url": "url3"}]);
  var r3 = $.tsAt(1);
  r3();

  wpcp.setUrls([{"priority": 2, "url": "url2"}, {"priority": 1, "url": "url3"}, {"priority": 3, "url": "url4"}]);
  equal(ws[3].passedUrl, "url4");
  ws[3].onopen();
  ws[3].popMessage([0, 0, {"sessionid":"SID"}]);
  ws[3].pushMessage([3, 0, {"sessionid":"SID"}]);
  var r4 = $.tsAt(3);
  r4();

  wpcp.setUrls([{"priority": 2, "url": "url2"}, {"priority": 1, "url": "url3"}, {"url": "url4"}]);
  var r5 = $.tsAt(1);
  r5();

  equal(ws[3].closeCount, 0);
  wpcp.setUrls([{"priority": 1, "url": "url3"}]);
  equal(ws[3].closeCount, 1);
  var r6 = $.tsAt(2);
  equal(ws[1].closeCount, 0);
  r6();
  equal(ws[1].closeCount, 1);
  ws[1].onclose();
  ws[3].onclose();

  equal(ws[0].closeCount, 1);
  equal(ws[1].closeCount, 1);
  equal(ws[2].closeCount, 0);
  equal(ws[3].closeCount, 1);
});

testMe("transfersession", function(ws) {
  var wpcp_hello_methods = [
    "publish", 0,
    "processed", 0,
    "progress", 0,
    "result", 0,
    "subscribedata", 3,
    "test", 1,
    "transfersession", 1,
    "unsubscribe", 1
  ];

  var consoleErrorOutput = [];
  var originalConsoleError = console.error;
  console.error = function(data) {
    consoleErrorOutput.push(data);
  };

  var newSessionsCount = 0;
  var resultCount1 = 0;
  var resultCount2 = 0;
  var resultCount3 = 0;
  var publishCount = 0;
  var progressCount = 0;
  var wpcp = new Wpcp(["url1", "url2"]);
  var $ = new TestHelper(wpcp, ws, wpcp_hello_methods);

  equal(ws[0].passedUrl, "url1");
  equal(ws[1].passedUrl, "url2");
  ws[0].onopen();
  ws[1].onopen();
  ws[0].popMessage([0, 0, {}]);
  ws[0].pushMessage([3, 0, {"methods":wpcp_hello_methods, "sessionid":"SID"}]);
  ws[1].popMessage([0, 0, {"sessionid":"SID"}]);
  ws[1].pushMessage([3, 0, {"sessionid":"SID"}]);

  wpcp.callMethod("test", ["arg"], function() {
    ++resultCount1;
  });
  var r1 = $.reqAt(0, "test", "arg");
  strictEqual(resultCount1, 0);
  r1.res(null, {});
  strictEqual(resultCount1, 1);

  wpcp.callMethod("test", ["arg"], function() {
    ++resultCount2;
  }, function(data, idx) {
    ++progressCount;
    strictEqual(data, "progr" + progressCount);
    strictEqual(idx, 0);
  });
  var r2 = $.reqAt(0, "test", "arg");
  r2.prg(0, "progr1");

  wpcp.setUrls([{"priority": 1, "url": "url1"}, {"priority": 2, "url": "url2"}]);
  var r3 = $.tsAt(1, "result", r1.sn);
  r2.prg(0, "progr2");
  strictEqual(resultCount2, 0);
  r2.res(0, null, {});
  strictEqual(resultCount2, 1);
  r3(r2);

  r2.prgAt(1, 0, "progr2");
  r2.resAt(1, null, {});

  wpcp.callMethod("test", ["arg"], function() {
    ++resultCount3;
  });
  var r4 = $.reqAt(1, "test", "arg");

  wpcp.subscribeData([{id:"A"}], function(){
    ++publishCount;
  });
  var r5 = $.reqAt(1, "subscribedata", {id:"A"});
  r5.res(null, 1);

  strictEqual(publishCount, 0);
  var p1 = $.publishAt(1, 1, {});
  var p2 = $.publishAt(1, 1, {});
  strictEqual(publishCount, 2);
  p1();
  p2();

  wpcp.setUrls([{"priority": 2, "url": "url1"}, {"priority": 1, "url": "url2"}]);
  var r6 = $.tsAt(0, "publish", p2.sn);
  strictEqual(publishCount, 2);
  var p3 = $.publishAt(1, 1, {});
  strictEqual(publishCount, 3);
  $.pushMessage([$.getId("result"), 999999]);
  r6(r5);

  p1(0);
  p2(0);
  p3.againAt(0);
  p3(0);

  r4.resAt(1, null, {});
  $.publishAt(1, 1, {});

  strictEqual(publishCount, 3);
  var p4 = $.publishAt(0, 1, {});
  strictEqual(publishCount, 4);
  p4();

  strictEqual(resultCount3, 0);
  r4.resAt(0, null, {});
  strictEqual(resultCount3, 1);

  wpcp.setUrls([{"priority": 1, "url": "url1"}, {"priority": 2, "url": "url2"}]);
  var r6 = $.tsAt(1, "result", r4.sn);
  r6();

  strictEqual(publishCount, 4);
  var p5 = $.publishAt(1, 1, {});
  strictEqual(publishCount, 5);
  p5();

  wpcp.callMethod("test", ["arg1"], function() {
  });
  var r7 = $.reqAt(1, "test", "arg1");

  wpcp.setUrls([{"priority": 2, "url": "url1"}, {"priority": 1, "url": "url2"}]);
  var r8 = $.tsAt(0, "publish", p5.sn);
  r7.resAt(1, null, {});
  r8();

  $.publishAt(0, 1, {});

  equal(ws[0].closeCount, 0);
  equal(ws[1].closeCount, 0);

  strictEqual(resultCount1, 1);
  strictEqual(resultCount2, 1);
  strictEqual(resultCount3, 1);

  deepEqual(consoleErrorOutput, ["New session sent differnt data"]);

  console.error = originalConsoleError;
});

testMe("received invalid sessionid", function(ws) {
  var consoleErrorOutput = [];
  var originalConsoleError = console.error;
  console.error = function(data) {
    consoleErrorOutput.push(data);
 };

  var wpcp = new Wpcp(["url1", "url2"]);
  var $ = new TestHelper(wpcp, ws, WPCP_METHODS);

  equal(ws[0].passedUrl, "url1");
  equal(ws[1].passedUrl, "url2");
  ws[0].onopen();
  ws[1].onopen();
  ws[0].popMessage([0, 0, {}]);
  ws[0].pushMessage([$.getId("result"), 0, {"methods":WPCP_METHODS, "sessionid":"SID"}]);
  ws[1].popMessage([0, 0, {"sessionid":"SID"}]);
  ws[1].pushMessage([$.getId("result"), 0, {"sessionid":"INVALID"}]);

  deepEqual(consoleErrorOutput, ["Received invalid sessionId INVALID"]);

  console.error = originalConsoleError;
});

testWpcp("call invalid method", function($, wpcp) {
  throws(function() {
    wpcp.callMethod("invalidmethod", []);
  },
  /Server does not support calling invalidmethod/);
});

testWpcp("received invalid messageid", function($, wpcp) {
  var consoleErrorOutput = [];
  var originalConsoleError = console.error;
  console.error = function(data) {
    consoleErrorOutput.push(data);
  };

  $.pushMessage([1234, 0, 1234]);

  deepEqual(consoleErrorOutput, ["Received invalid messageId 1234"]);

  console.error = originalConsoleError;
});

testWpcp("callMethod with result", function($, wpcp) {
  var resultCount = 0;
  wpcp.callMethod("test", ["arg"], function(data, err) {
    strictEqual(err[0], "err");
    strictEqual(data[0], "ret");
    ++resultCount;
  }, okFalse);

  var r = $.req("test", "arg");

  equal(resultCount, 0);

  r.res("err", "ret");

  equal(resultCount, 1);
});

testWpcp("callMethod with different arguments", function($, wpcp) {
  var resultCount = 0;
  wpcp.callMethod("test", [true, 2, 3.4, "5", [6], {"7":8}], function(data, err) {
    ok(err[0] || true);
    ok(err[1] || true);
    ok(err[2] || true);
    ok(err[3] || true);
    ok(err[4] || true);
    ok(err[5] || true);
    deepEqual(data, [{"7":8}, [6], "5", 4.3, 2, true]);
    ++resultCount;
  }, okFalse);

  var r = $.req("test", true, 2, 3.4, "5", [6], {"7":8});

  equal(resultCount, 0);

  r.res(null, {"7":8}, null, [6], null, "5", null, 4.3, null, 2, null, true);

  equal(resultCount, 1);
});

testWpcp("callMethod without callbacks", function($, wpcp) {
  wpcp.callMethod("test", ["arg"]);
  var r = $.req("test", "arg");
  r.prg(0, "progr");
  r.res(null, "ret");
});

testWpcp("callMethod with throwing callbacks", function($, wpcp) {
  var consoleErrorOutput = [];
  wpcp.oncatch = function(data) {
    consoleErrorOutput.push(data);
  };

  wpcp.callMethod("test", ["arg"], function() {
    throw "Result";
  }, function() {
    throw "Progress";
  });

  var r = $.req("test", "arg");
  r.prg(0, "progr");
  r.res(null, "ret");

  deepEqual(consoleErrorOutput, ["Progress", "Result"]);
});

testWpcp("callMethod with progress", function($, wpcp) {
  var progressCount = 0;
  var resultCount = 0;
  wpcp.callMethod("test", ["arg"], function(data, err) {
    ok(err[0] || true);
    strictEqual(data[0], "ret");
    ++resultCount;
  }, function(data, idx) {
    ++progressCount;
    strictEqual(data, "progr" + progressCount);
    strictEqual(idx, 0);
  });

  var r = $.req("test", "arg");

  equal(progressCount, 0);

  r.prg(0, "progr1");

  equal(progressCount, 1);

  r.prg(0, "progr2", 0, "progr3");

  equal(progressCount, 3);

  r.prg(0, "progr4");

  equal(progressCount, 4);
  equal(resultCount, 0);

  r.res(null, "ret");

  equal(progressCount, 4);
  equal(resultCount, 1);
});

testWpcp("parallel calls with ordered results", function($, wpcp) {
  var resultCount1 = 0;
  var resultCount2 = 0;
  var resultCount3 = 0;

  wpcp.callMethod("test1", ["arg1"], function(data) {
    strictEqual(data[0], "ret1");
    ++resultCount1;
  }, okFalse);

  wpcp.callMethod("test2", ["arg2"], function(data) {
    strictEqual(data[0], "ret2");
    ++resultCount2;
  }, okFalse);

  wpcp.callMethod("test3", ["arg3"], function(data) {
    strictEqual(data[0], "ret3");
    ++resultCount3;
  }, okFalse);

  var r1 = $.req("test1", "arg1");
  var r2 = $.req("test2", "arg2");
  var r3 = $.req("test3", "arg3");

  equal(resultCount1, 0);

  r1.res(null, "ret1");

  equal(resultCount1, 1);
  equal(resultCount2, 0);

  r2.res(null, "ret2");

  equal(resultCount2, 1);
  equal(resultCount3, 0);

  r3.res(null, "ret3");

  equal(resultCount1, 1);
  equal(resultCount2, 1);
  equal(resultCount3, 1);
});

testWpcp("parallel calls with unordered results", function($, wpcp) {
  var resultFunctionData = [];

  function resultFunction(data) {
    resultFunctionData.push(data);
  }

  wpcp.callMethod("test1", ["arg1"], resultFunction, okFalse);
  var r1 = $.req("test1", "arg1");

  wpcp.callMethod("test2", ["arg2"], resultFunction, okFalse);
  var r2 = $.req("test2", "arg2");

  wpcp.callMethod("test3", ["arg3"], resultFunction, okFalse);
  var r3 = $.req("test3", "arg3");

  wpcp.callMethod("test4", ["arg4"], resultFunction, okFalse);
  var r4 = $.req("test4", "arg4");

  wpcp.callMethod("test5", ["arg5"], resultFunction, okFalse);
  var r5 = $.req("test5", "arg5");

  r2.res(null, "ret2");
  r4.res(null, "ret4");

  wpcp.callMethod("test6", ["arg6"], resultFunction, okFalse);
  var r6 = $.req("test6", "arg6");

  wpcp.callMethod("test7", ["arg7"], resultFunction, okFalse);
  var r7 = $.req("test7", "arg7");

  wpcp.callMethod("test8", ["arg8"], resultFunction, okFalse);
  var r8 = $.req("test8", "arg8");

  r3.res(null, "ret3");
  r1.res(null, "ret1");

  wpcp.callMethod("test9", ["arg9"], resultFunction, okFalse);
  var r9 = $.req("test9", "arg9");

  wpcp.callMethod("test10", ["arg10"], resultFunction, okFalse);
  var r10 = $.req("test10", "arg10");

  r5.res(null, "ret5");
  r7.res(null, "ret7");
  r8.res(null, "ret8");
  r6.res(null, "ret6");
  r10.res(null, "ret10");
  r9.res(null, "ret9");

  deepEqual(resultFunctionData, [["ret2"], ["ret4"], ["ret3"], ["ret1"], ["ret5"], ["ret7"], ["ret8"], ["ret6"], ["ret10"], ["ret9"]]);
});

testWpcp("cancel simple call", function($, wpcp) {
  var progressCount = 0;
  var resultCount = 0;
  var token = wpcp.callMethod("test", ["arg"], function(data, err) {
    strictEqual(err[0], "canceled");
    strictEqual(data[0], null);
    ++resultCount;
  }, function(data, idx) {
    ++progressCount;
    strictEqual(data, progressCount);
    strictEqual(idx, 0);
  });

  var r = $.req("test", "arg");
  r.prg(0, 1);

  wpcp.cancelCall(token);

  r.cancel();

  throws(function() {
    wpcp.cancelCall(token);
  });

  throws(function() {
    wpcp.cancelCall("invalid");
  });

  r.prg(0, 2);
  r.res("canceled", null);

  equal(progressCount, 2);
  equal(resultCount, 1);
});

testWpcp("cancel invalid call", function($, wpcp) {
  throws(function() {
    wpcp.cancelCall("invalid");
  });
});

function testCall(name, messsageId) {
  testWpcp(name + " with result", function($, wpcp) {
    var resultCount = 0;
    wpcp[name](["id"], function(data, err) {
      deepEqual(data, ["ret"]);
      deepEqual(err, [null]);
      ++resultCount;
    }, okFalse);

    var r = $.req(messsageId, "id");

    equal(resultCount, 0);

    r.res(null, "ret");

    equal(resultCount, 1);
  });


  testWpcp(name + " with error", function($, wpcp) {
    var resultCount = 0;
    wpcp[name](["id"], function(data, err) {
      deepEqual(data, [null]);
      deepEqual(err, ["error"]);
      ++resultCount;
    }, okFalse);

    var r = $.req(messsageId, "id");

    equal(resultCount, 0);

    r.res("error", null);

    equal(resultCount, 1);
  });
}

testCall("browse", "browse");
testCall("handleAlarm", "handlealarm");
testCall("readData", "readdata");
testCall("readHistoryAlarm", "readhistoryalarm");
testCall("readHistoryData", "readhistorydata");
testCall("writeData", "writedata");

testWpcp("subscribe invalid method", function($, wpcp) {
  throws(function() {
    wpcp.subscribeInternal("invalidmethod", []);
  },
  /Server does not support subscribing invalidmethod/);
});

testWpcp("subscribeAudit", function($, wpcp) {
  var publishCount = 0;
  var subscribeResultCount = 0;
  var token = wpcp.subscribeAudit(["topic"], function(data, id) {
    equal(id, 0);
    if (publishCount === 0)
      equal(data, "a");
    if (publishCount === 1)
      equal(data, "b");
    ++publishCount;
  }, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCount;
  });

  var r1 = $.req("subscribeaudit", "topic");

  equal(subscribeResultCount, 0);

  r1.res(null, 11);

  equal(publishCount, 0);
  equal(subscribeResultCount, 1);

  $.publish(11, "a", 11, "b")();

  equal(publishCount, 2);

  var unsubscribeResultCount = 0;
  wpcp.unsubscribe(token, function(data) {
    strictEqual(data[0], 1);
    ++unsubscribeResultCount;
  });

  var r2 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCount, 0);

  r2.res(null, 1);

  equal(publishCount, 2);
  equal(subscribeResultCount, 1);
  equal(unsubscribeResultCount, 1);
});

testWpcp("subscribeData", function($, wpcp) {
  var publishCount = 0;
  var subscribeResultCount = 0;
  var token = wpcp.subscribeData(["topic"], function(data, id) {
    equal(id, 0);
    if (publishCount === 0)
      equal(data, "a");
    if (publishCount === 1)
      equal(data, "b");
    ++publishCount;
  }, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCount;
  });

  var r1 = $.req("subscribedata", "topic");

  equal(subscribeResultCount, 0);

  r1.res(null, 11);

  equal(publishCount, 0);
  equal(subscribeResultCount, 1);

  $.publish(11, "a", 11, "b")();

  equal(publishCount, 2);

  var unsubscribeResultCount = 0;
  wpcp.unsubscribe(token, function(data) {
    strictEqual(data[0], 1);
    ++unsubscribeResultCount;
  });

  var r2 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCount, 0);

  r2.res(null, 1);

  equal(publishCount, 2);
  equal(subscribeResultCount, 1);
  equal(unsubscribeResultCount, 1);
});

testWpcp("subscribeData twice", function($, wpcp) {
  var publishCount = 0;
  var subscribeResultCount = 0;
  var tokenA = wpcp.subscribeData(["topic"], function(data, id) {
    ++publishCount;
    strictEqual(id, 0);
    strictEqual(data, "a");
  }, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCount;
  });

  var r1 = $.req("subscribedata", "topic");

  equal(subscribeResultCount, 0);

  r1.res(null, 11);

  equal(publishCount, 0);
  equal(subscribeResultCount, 1);

  $.publish(11, "a")();

  equal(publishCount, 1);

  var unsubscribeResultCount = 0;
  wpcp.unsubscribe(tokenA, function(data) {
    strictEqual(data[0], 1);
    ++unsubscribeResultCount;
  });

  var r2 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCount, 0);

  r2.res(null, 1);

  equal(unsubscribeResultCount, 1);

  var tokenB = wpcp.subscribeData(["topic"], function(data, id) {
    ++publishCount;
    strictEqual(id, 0);
    strictEqual(data, "b");
  }, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCount;
  });

  var r3 = $.req("subscribedata", "topic");

  equal(subscribeResultCount, 1);

  r3.res(null, 11);

  equal(publishCount, 1);
  equal(subscribeResultCount, 2);

  $.publish(11, "b")();

  equal(publishCount, 2);

  wpcp.unsubscribe(tokenB, function(data) {
    strictEqual(data[0], 1);
    ++unsubscribeResultCount;
  });

  var r2 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCount, 1);

  r2.res(null, 1);

  equal(publishCount, 2);
  equal(subscribeResultCount, 2);
  equal(unsubscribeResultCount, 2);
});

testWpcp("subscribeData with publish", function($, wpcp) {
  var publishCount = 0;
  var subscribeResultCount = 0;
  var token = wpcp.subscribeData(["topic"], function(data, id) {
    ++publishCount;
    strictEqual(id, 0);
    strictEqual(data, publishCount);
  }, function(data) {
    strictEqual(data[0], 1);
    ++subscribeResultCount;
  });

  var r1 = $.req("subscribedata", "topic");

  equal(subscribeResultCount, 0);

  r1.res(null, 1);

  equal(publishCount, 0);
  equal(subscribeResultCount, 1);

  $.publish(1, 1)();

  equal(publishCount, 1);

  $.publish(1, 2, 1, 3)();

  equal(publishCount, 3);

  $.publish(1, 4)();

  equal(publishCount, 4);
  equal(subscribeResultCount, 1);

  var unsubscribeResultCount = 0;
  wpcp.unsubscribe(token, function(data) {
    strictEqual(data[0], 1);
    ++unsubscribeResultCount;
  });

  var r2 = $.req("unsubscribe", 1);

  equal(unsubscribeResultCount, 0);

  r2.res(null, 1);

  equal(publishCount, 4);
  equal(subscribeResultCount, 1);
  equal(unsubscribeResultCount, 1);
});

testWpcp("subscribeData multi with publish", function($, wpcp) {
  var publishFunctionData = [];
  var subscribeResultCount = 0;
  var token = wpcp.subscribeData(["topic1", "topic2", "topic3"], function(data, id) {
    publishFunctionData.push([id, data]);
  }, function(data, err) {
    strictEqual(data[0], 11);
    strictEqual(err[1], "Unknown topic");
    strictEqual(data[1], 0);
    strictEqual(data[2], 22);
    ++subscribeResultCount;
  });

  var r1 = $.req("subscribedata", "topic1", "topic2", "topic3");

  equal(subscribeResultCount, 0);

  r1.res(null, 11, "Unknown topic", 0, null, 22);

  deepEqual(publishFunctionData, []);
  equal(subscribeResultCount, 1);

  $.publish(11, 1101)();

  deepEqual(publishFunctionData, [[0, 1101]]);

  $.publish(11, 1102, 22, 2201)();

  deepEqual(publishFunctionData, [[0, 1101], [0, 1102], [2, 2201]]);

  $.publish(22, 2202, 11, 1103)();

  deepEqual(publishFunctionData, [[0, 1101], [0, 1102], [2, 2201], [2, 2202], [0, 1103]]);

  $.publish(22, 2203, 22, 2204)();

  deepEqual(publishFunctionData, [[0, 1101], [0, 1102], [2, 2201], [2, 2202], [0, 1103], [2, 2203], [2, 2204]]);

  $.publish(11, 1104, 11, 1105, 22, 2204, 11, 1105, 11, 1106, 22, 2205)();

  deepEqual(publishFunctionData, [[0, 1101], [0, 1102], [2, 2201], [2, 2202], [0, 1103], [2, 2203], [2, 2204], [0, 1104], [0, 1105], [2, 2204], [0, 1105], [0, 1106], [2, 2205]]);

  var unsubscribeResultCount = 0;
  wpcp.unsubscribe(token, function(data) {
    strictEqual(data[0], 1);
    strictEqual(data[1], 0);
    strictEqual(data[2], 1);
    ++unsubscribeResultCount;
  });

  var r2 = $.req("unsubscribe", 11, 22);

  equal(unsubscribeResultCount, 0);

  r2.res(null, 1, null, 1);

  deepEqual(publishFunctionData, [[0, 1101], [0, 1102], [2, 2201], [2, 2202], [0, 1103], [2, 2203], [2, 2204], [0, 1104], [0, 1105], [2, 2204], [0, 1105], [0, 1106], [2, 2205]]);
  equal(subscribeResultCount, 1);
  equal(unsubscribeResultCount, 1);
});

testWpcp("subscribeData duplicates", function($, wpcp) {
  var subscribeResultCountA = 0;
  var tokenA = wpcp.subscribeData(["topic1"], okFalse, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCountA;
  });

  var r1 = $.req("subscribedata", "topic1");

  equal(subscribeResultCountA, 0);

  r1.res(null, 11);

  equal(subscribeResultCountA, 1);

  var subscribeResultCountB = 0;
  var tokenB = wpcp.subscribeData(["topic1", "topic2"], okFalse, function(data) {
    strictEqual(data[0], 11);
    strictEqual(data[1], 22);
    ++subscribeResultCountB;
  });

  var subscribeResultCountC = 0;
  var tokenC = wpcp.subscribeData(["topic2"], okFalse, function(data) {
    strictEqual(data[0], 22);
    ++subscribeResultCountC;
  });

  var r2 = $.req("subscribedata", "topic2");

  equal(subscribeResultCountB, 0);
  equal(subscribeResultCountC, 0);

  r2.res(null, 22);

  equal(subscribeResultCountB, 1);
  equal(subscribeResultCountC, 1);

  var unsubscribeResultCountA = 0;
  wpcp.unsubscribe(tokenA, function(data) {
    strictEqual(data[0], 2);
    ++unsubscribeResultCountA;
  });

  equal(unsubscribeResultCountA, 1);

  var unsubscribeResultCountB = 0;
  wpcp.unsubscribe(tokenB, function(data) {
    strictEqual(data[0], 1);
    strictEqual(data[1], 2);
    ++unsubscribeResultCountB;
  });

  var r3 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCountB, 0);

  var unsubscribeResultCountC = 0;
  wpcp.unsubscribe(tokenC, function(data) {
    strictEqual(data[0], 1);
    ++unsubscribeResultCountC;
  });

  var r4 = $.req("unsubscribe", 22);

  equal(unsubscribeResultCountC, 0);

  r4.res(null, 1);

  equal(unsubscribeResultCountC, 1);

  r3.res(null, 1);

  equal(subscribeResultCountA, 1);
  equal(subscribeResultCountB, 1);
  equal(subscribeResultCountC, 1);
  equal(unsubscribeResultCountA, 1);
  equal(unsubscribeResultCountB, 1);
  equal(unsubscribeResultCountC, 1);
});

testWpcp("subscribeData duplicates with publish", function($, wpcp) {
  var publishCountA = 0;
  var tokenA = wpcp.subscribeData(["topic"], function(value, id) {
    equal(id, 0);
    if (publishCountA === 0)
      equal(value, "a");
    if (publishCountA === 1)
      equal(value, "b");
    if (publishCountA === 2)
      equal(value, "c");
    ++publishCountA;
  });

  var r1 = $.req("subscribedata", "topic");
  r1.res(null, 11);

  equal(publishCountA, 0);

  $.publish(11, "a", 11, "b")();

  equal(publishCountA, 2);

  var publishCountB = 0;
  var tokenB = wpcp.subscribeData(["topic"], function(value, id) {
    equal(id, 0);
    if (publishCountB === 0)
      equal(value, "b");
    if (publishCountB === 1)
      equal(value, "c");
    if (publishCountB === 2)
      equal(value, "d");
    ++publishCountB;
  });
  equal(publishCountB, 1);

  $.publish(11, "c")();

  equal(publishCountA, 3);
  equal(publishCountB, 2);

  wpcp.unsubscribe(tokenA);

  $.publish(11, "d")();

  equal(publishCountA, 3);
  equal(publishCountB, 3);

  wpcp.unsubscribe(tokenB);

  var r2 = $.req("unsubscribe", 11);
  r2.res(null, 1);

  equal(publishCountA, 3);
  equal(publishCountB, 3);
});

testWpcp("subscribeData same subscriptionid", function($, wpcp) {
  var subscribeResultCountA = 0;
  var tokenA = wpcp.subscribeData(["topic1"], okFalse, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCountA;
  });

  var r1 = $.req("subscribedata", "topic1");

  equal(subscribeResultCountA, 0);

  r1.res(null, 11);

  equal(subscribeResultCountA, 1);

  var subscribeResultCountB = 0;
  var tokenB = wpcp.subscribeData(["topic2"], okFalse, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCountB;
  });

  var r2 = $.req("subscribedata", "topic2");

  equal(subscribeResultCountB, 0);

  r2.res(null, 11);

  equal(subscribeResultCountB, 1);

  var unsubscribeResultCountA = 0;
  wpcp.unsubscribe(tokenA, function(data) {
    strictEqual(data[0], 2);
    ++unsubscribeResultCountA;
  });

  var r3 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCountA, 0);

  r3.res(null, 2);

  equal(unsubscribeResultCountA, 1);

  var subscribeResultCountC = 0;
  var tokenC = wpcp.subscribeData(["topic1"], okFalse, function(data) {
    strictEqual(data[0], 11);
    ++subscribeResultCountC;
  });

  var r4 = $.req("subscribedata", "topic1");

  equal(subscribeResultCountC, 0);

  r4.res(null, 11);

  equal(subscribeResultCountC, 1);

  var unsubscribeResultCountC = 0;
  wpcp.unsubscribe(tokenC, function(data) {
    strictEqual(data[0], 2);
    ++unsubscribeResultCountC;
  });

  var r4 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCountC, 0);

  r4.res(null, 2);

  equal(unsubscribeResultCountC, 1);

  var unsubscribeResultCountB = 0;
  wpcp.unsubscribe(tokenB, function(data) {
    strictEqual(data[0], 1);
    ++unsubscribeResultCountB;
  });

  var r4 = $.req("unsubscribe", 11);

  equal(unsubscribeResultCountB, 0);

  r4.res(null, 1);

  equal(subscribeResultCountA, 1);
  equal(subscribeResultCountB, 1);
  equal(subscribeResultCountC, 1);
  equal(unsubscribeResultCountA, 1);
  equal(unsubscribeResultCountB, 1);
  equal(unsubscribeResultCountC, 1);
});

testWpcp("subscribeAlarm", function($, wpcp) {
  var consoleErrorOutput = [];
  var originalConsoleError = console.error;
  console.error = function(data) {
    consoleErrorOutput.push(data);
  };

  var publishCount = 0;
  var subscribeResultCount = 0;
  var token = wpcp.subscribeAlarm(["topic"], function(value, id) {
    equal(id, 0);
    equal(value.key, 1);
    if (publishCount === 0)
      equal(value.value, "a");
    if (publishCount === 1)
      equal(value.value, "b");
    ++publishCount;
  }, function(data) {
    strictEqual(data[0], 44);
    ++subscribeResultCount;
  });

  var r1 = $.req("subscribealarm", "topic");

  equal(subscribeResultCount, 0);

  r1.res(null, 44);

  equal(publishCount, 0);
  equal(subscribeResultCount, 1);

  $.publish(44, {key:1, value:"a"}, 44, {key:1, value:"b"})();

  equal(publishCount, 2);

  var unsubscribeResultCount = 0;
  wpcp.unsubscribe(token, function(data, err) {
    strictEqual(err[0], "err");
    strictEqual(data[0], 0);
    ++unsubscribeResultCount;
  });

  var r2 = $.req("unsubscribe", 44);

  equal(unsubscribeResultCount, 0);

  r2.res("err", 0);

  equal(publishCount, 2);
  equal(subscribeResultCount, 1);
  equal(unsubscribeResultCount, 1);
  deepEqual(consoleErrorOutput, ["Can not unsubscribe"]);

  console.error = originalConsoleError;
});

testWpcp("subscribeAlarm duplicates with publish", function($, wpcp) {
  var publishCountA = 0;
  var tokenA = wpcp.subscribeAlarm(["topic"], function(value, id) {
    equal(id, 0);
    if (publishCountA === 0)
      deepEqual(value, {key:1,retain:true,value:"a"});
    if (publishCountA === 1)
      deepEqual(value, {key:1,retain:true,value:"b"});
    if (publishCountA === 2)
      deepEqual(value, {key:2,retain:true,value:"c"});
    if (publishCountA === 3)
      deepEqual(value, {key:2,retain:true,value:"d"});
    ++publishCountA;
  });

  var r1 = $.req("subscribealarm", "topic");
  r1.res(null, 11);

  equal(publishCountA, 0);

  $.publish(11, {key:1,retain:true,value:"a"}, 11, {key:1,retain:true,value:"b"}, 11, {key:2,retain:true,value:"c"})();

  equal(publishCountA, 3);

  var publishCountB = 0;
  var tokenB = wpcp.subscribeAlarm(["topic"], function(value, id) {
    equal(id, 0);
    if (publishCountB === 0)
      deepEqual(value, {key:1,retain:true,value:"b"});
    if (publishCountB === 1)
      deepEqual(value, {key:2,retain:true,value:"c"});
    if (publishCountB === 2)
      deepEqual(value, {key:2,retain:true,value:"d"});
    if (publishCountB === 3)
      deepEqual(value, {key:1,retain:true,value:"e"});
    ++publishCountB;
  });
  equal(publishCountB, 2);

  $.publish(11, {key:2,retain:true,value:"d"})();

  equal(publishCountA, 4);
  equal(publishCountB, 3);

  wpcp.unsubscribe(tokenA);

  $.publish(11, {key:1,retain:true,value:"e"})();

  equal(publishCountA, 4);
  equal(publishCountB, 4);

  wpcp.unsubscribe(tokenB);

  var r2 = $.req("unsubscribe", 11);
  r2.res(null, 1);

  equal(publishCountA, 4);
  equal(publishCountB, 4);
});
