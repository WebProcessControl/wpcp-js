/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014-2015 Patrick Gansterer <paroga@paroga.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

(function(global, undefined) { "use strict";
var wpcpCbor;

function dummy() {
}

function serializeToString(obj) {
  var uint8array = new Uint8Array(wpcpCbor.encode(obj));
  var arr = [];
  for (var i = 0; i < uint8array.length; ++i)
    arr.push(uint8array[i]);
  return String.fromCharCode.apply(null, arr);
}

function Wpcp(urls, options) {
  this.options = options;
  this.channels = [];
  this.subscriptions = {};
  this.subscriptionObjects = {};
  this.subscriptionTokens = {};
  this.nextRequestId = 0;
  this.pendingRequests = {};
  this.nextToken = 0;
  this.nextSubscriptionToken = 0;
  this.lastReceivedMessage = null;
  this.withholdRequestId = undefined;
  this.inQueue = null;
  this.outQueue = [];
  this.outBuffer = null;


  if (!(urls instanceof Array))
    urls = [urls];
  var infos = [];
  urls.forEach(function(url) {
    if (typeof url !== "string")
      throw "first parameter must be an array of strings";
    infos.push({
      url: url
    });
  });
  this.setUrls(infos);
}

function Channel(wpcp, url) {
  this.wpcp = wpcp;
  this.info = {
    active: false,
    connected: false,
    url: url
  };
}

Channel.prototype.setInfo = function(info) {
  this.info.priority = info.priority;
};

Channel.prototype.close = function() {
  this.webSocket.close();
};

Channel.prototype.open = function() {
  var self = this;
  var wpcp = self.wpcp;
  this.webSocket = new WebSocket(this.info.url, ["wpcp"]);
  this.webSocket.binaryType = "arraybuffer";

  function handleFunction(data) {
    if (wpcp.inQueue)
      wpcp.inQueue.push(data);
    if (data[0] in wpcp.methodIdCallback)
      wpcp.methodIdCallback[data[0]](data[1], data.slice(2), data);
    else
      console.error("Received invalid messageId " + data[0]);
  }

  function publishFunction(id, data, recv) {
    wpcp.lastReceivedMessage = recv;

    for (var i = 0; i < data.length; i += 2) {
      var itm = wpcp.subscriptions[data[i]].callbacks;
      wpcp.subscriptions[data[i]].lastValueHandler(data[i+1]);
      for (var key in itm) {
        if (itm.hasOwnProperty(key))
          wpcp.catchThrow(itm[key][0], data[i+1], itm[key][1]);
      }
    }

    self.sendOrQueue([wpcp.messageIdProcessed, id]);
  }

  function progressFunction(requestId, data) {
    var callback = wpcp.pendingRequests[requestId].onprogress;
    for (var i = 0; i < data.length; i += 2)
      wpcp.catchThrow(callback, data[i+1], data[i]);
  }

  function resultFunction(requestId, data, recv) {
    wpcp.lastReceivedMessage = recv;

    var tempInfo = [];
    var tempData = [];

    for (var i = 0; i < data.length; i += 2) {
      tempInfo.push(data[i]);
      tempData.push(data[i+1]);
    }

    wpcp.catchThrow(wpcp.pendingRequests[requestId].onresult, tempData, tempInfo);
    delete wpcp.pendingRequests[requestId];

    self.removeRequestId(requestId);
  }

  this.handleFunction = handleFunction;

  this.webSocket.onmessage = function(event) {
    var obj = wpcpCbor.decode(event.data);
    return self.onmessage(obj);
  };
  this.webSocket.onopen = function() {
    self.info.connected = true;
    wpcp.callSessionStateChangeCallback();

    if (wpcp.pendingChannels) {
      self.onmessage = function(data) {
        self.helloResult = data[2];
        if (self.helloResult.sessionid !== wpcp.sessionid)
          console.error("Received invalid sessionId " + self.helloResult.sessionid);
        else {
          self.info.passive = true;
          this.onmessage = handleFunction;

          if ("requestTransfer" in self)
            self.transferSession(self.requestTransfer);
        }
      };

      wpcp.pendingChannels.push(self);
      wpcp.processPendingChannels();
      return;
    }

    self.onmessage = function(data) {
      self.helloResult = data[2];
      self.info.active = true;
      wpcp.endpoint = self;
      wpcp.methodIdCallback = {};
      wpcp.methodInfos = {};
      wpcp.messageIdProcessed = null;

      wpcp.sessionid = self.helloResult.sessionid;
      wpcp.processPendingChannels();

      var methods = self.helloResult.methods;
      for (var i = 0; i < methods.length; i += 2) {
        var methodId = i / 2;
        var methodName = methods[i + 0];
        var methodType = methods[i + 1];

        switch (methodName) {
          case "processed":
            wpcp.messageIdProcessed = methodId;
            break;

          case "cancelcall":
            wpcp.messageIdCancelCall = methodId;
            break;

          case "publish":
            wpcp.methodIdCallback[methodId] = publishFunction;
            break;

          case "progress":
            wpcp.methodIdCallback[methodId] = progressFunction;
            break;

          case "result":
            wpcp.messageIdResult = methodId;
            wpcp.methodIdCallback[methodId] = resultFunction;
            break;

          default:
            wpcp.methodInfos[methodName] = {
              id: methodId,
              type: methodType
            };
        }
      }

      this.onmessage = handleFunction;

      if ("subscribeurls" in wpcp.methodInfos)
        wpcp.subscribeInternal("subscribeurls", [{}], function(result) {
          wpcp.setUrls(result);
        });

      wpcp.catchThrow(wpcp.onnewsession);
    };

    wpcp.pendingChannels = [];
    self.send([0, 0, {}]);
  };

  this.webSocket.onclose = function() {
    self.info.connected = false;
    delete self.webSocket;
  };
};

Channel.prototype.sendOrQueue = function(data) {
  if (this.wpcp.endpoint)
    return this.wpcp.endpoint.send(data);
  this.wpcp.outBuffer.push(data);
};

Channel.prototype.send = function(data) {
  this.wpcp.outQueue.push(data);
  return this.webSocket.send(wpcpCbor.encode(data));
};

Channel.prototype.createRequestId = function() {
  var wpcp = this.wpcp;
  while (wpcp.nextRequestId in wpcp.pendingRequests || wpcp.nextRequestId === wpcp.withholdRequestId)
    ++wpcp.nextRequestId;
  return wpcp.nextRequestId++;
};

Channel.prototype.removeRequestId = function(requestId) {
  var wpcp = this.wpcp;
  if (wpcp.withholdRequestId < wpcp.nextRequestId)
    wpcp.nextRequestId = wpcp.withholdRequestId;
  wpcp.withholdRequestId = requestId;
};

Channel.prototype.callMethod = function(name, args, resultCallback, progressCallback) {
  var self = this;
  var wpcp = self.wpcp;

  var prefix = [wpcp.methodInfos[name].id];
  var requestId = this.createRequestId();

  wpcp.pendingRequests[requestId] = {
    token: wpcp.nextToken,
    onprogress: progressCallback,
    onresult: resultCallback
  };

  prefix.splice(1, 0, requestId);
  this.send(prefix.concat(args));
  return wpcp.nextToken++;
};

Channel.prototype.transferSession = function(closeEndpoint) {
  var self = this;
  var wpcp = self.wpcp;

  if (this.info.connected) {
    var oq = wpcp.outQueue.slice();
    var obj = wpcp.lastReceivedMessage ? {head:wpcp.lastReceivedMessage.slice(0, 2)} : {};
    wpcp.endpoint = null;
    wpcp.inQueue = [];
    wpcp.outBuffer = [];

    var methodId = wpcp.methodInfos.transfersession.id;
    var requestId = this.createRequestId();
    this.send([methodId, requestId, obj]);
    this.onmessage = function(data) {
      if (data[0] !== wpcp.messageIdResult || data[1] !== requestId)
        return;

      for (var i = 0; i < wpcp.channels.length; ++i)
        wpcp.channels[i].onmessage = dummy;

      var ret = data[3];
      if ("head" in ret) {
        var again = [];
        var head = ret.head;
        for (i = oq.length; i > 0; --i) {
          var e = oq[i-1];
          if (e[0] === head[0] && e[1] === head[1])
            break;
          again.splice(0, 0, e);
        }
        for (i = 0; i < again.length; ++i)
          self.send(again[i]);
      }
      if (closeEndpoint)
        closeEndpoint.close();

      function checkDone() {
        if (wpcp.inQueue.length)
          return;

        for (var i = 0; i < wpcp.outBuffer.length; ++i)
          self.send(wpcp.outBuffer[i]);

        self.info.active = true;
        wpcp.endpoint = self;
        wpcp.outQueue = [];
        wpcp.outBuffer = null;
        wpcp.inQueue = null;
        self.onmessage = self.handleFunction;
      }

      this.onmessage = function(data) {
        var item = wpcp.inQueue.shift();
        if (item[0] !== data[0] || item[1] !== data[1])
          console.error("New session sent differnt data");
        checkDone();
      };
      checkDone();

      self.removeRequestId(requestId);
    };
  } else {
    this.requestTransfer = closeEndpoint;
  }
};

Wpcp.prototype.catchThrow = function(fn, arg1, arg2, arg3) {
  if (typeof fn === "function") {
    try {
      fn(arg1, arg2, arg3);
    } catch (e) {
      try {
        if (typeof this.oncatch === "function")
          this.oncatch(e);
        else
          console.error(e);
      } catch (e2) {
      }
    }
  }
};

Wpcp.prototype.setUrls = function(urls) {
  var oldChannels = this.channels;
  var closeEndpoint = null;
  var newEndpoint = this.endpoint;
  this.channels = [];

  for (var i = 0; i < urls.length; ++i) {
    var channel = null;
    for (var j = 0; j < oldChannels.length; ++j) {
      if (oldChannels[j].info.url === urls[i].url) {
        channel = oldChannels[j];
        oldChannels.splice(j, 1);
        break;
      }
    }

    if (!channel)
      channel = new Channel(this, urls[i].url);

    channel.setInfo(urls[i]);
    this.channels.push(channel);
  }

  for (i = 0; i < oldChannels.length; ++i) {
    if (oldChannels[i] === newEndpoint) {
      closeEndpoint = oldChannels[i];
      newEndpoint = null;
    } else
      oldChannels[i].close();
  }

  {
    for (i = 0; i < this.channels.length; ++i) {
      var p1 = newEndpoint ? newEndpoint.info.priority : 0;
      var p2 = this.channels[i].info.priority;
      if (!newEndpoint || p2 && (!p1 || p1 < p2))
        newEndpoint = this.channels[i];

      if (!this.channels[i].webSocket)
        this.channels[i].open();
    }
  }

  if (this.endpoint && newEndpoint !== this.endpoint) {
    newEndpoint.transferSession(closeEndpoint);
  }

  this.callSessionStateChangeCallback();
};

Wpcp.prototype.processPendingChannels = function() {
  if (!this.sessionid)
    return;

  for (var i = 0; i < this.pendingChannels.length; ++i) {
    this.pendingChannels[i].send([0, 0, {"sessionid":this.sessionid}]);
  }

  this.pendingChannels = [];
};

Wpcp.prototype.callSessionStateChangeCallback = function() {
  if (typeof this.onsessionstatechange !== "function")
    return;

  var state = -1;
  var info = [];

  for (var i = 0; i < this.channels.length; ++i) {
    info.push(this.channels[i].info);
  }

  this.onsessionstatechange(state, info);
};

Wpcp.prototype.callMethod = function(name, args, resultCallback, progressCallback) {
  if (!(name in this.methodInfos))
    throw "Server does not support calling " + name;

  return this.endpoint.callMethod(name, args, resultCallback, progressCallback);
};

Wpcp.prototype.cancelCall = function(token) {
  var requestId = null;

  for (var key in this.pendingRequests) {
    if (this.pendingRequests.hasOwnProperty(key)) {
      var obj = this.pendingRequests[key];
      if (obj.token === token) {
        if (obj.canceled === true)
          throw "Already Canceled";

        obj.canceled = true;
        requestId = key * 1;
        break;
      }
    }
  }

  if (requestId === null)
    throw "Invalid Token";
  else
    this.endpoint.send([this.messageIdCancelCall, requestId]);
};

Wpcp.prototype.subscribeInternal = function(messageId, topic, publishCallback, resultCallback) {
  var self = this;
  var ret = [];
  var needToSubscribeTp = [];
  var needToSubscribeCb = [];
  var subscriptionObjects;
  var lastValueHandler;
  var remaining = topic.length;
  var rr = new Array(remaining);
  var ata = new Array(remaining);

  var messageType = messageId in this.methodInfos ? this.methodInfos[messageId].type : 0;

  if (messageType === 2) {
    lastValueHandler = function() {
    };
  } else if (messageType === 3) {
    lastValueHandler = function(value) {
      this.lastValue = value;
    };
  } else if (messageType === 4) {
    lastValueHandler = function(value) {
      if (!this.lastValues)
        this.lastValues = {};
      if (value.retain)
        this.lastValues[value.key] = value;
      else
        delete this.lastValues[value.key];
    };
  } else {
    throw "Server does not support subscribing " + messageId;
  }

  if (messageId in this.subscriptionObjects)
    subscriptionObjects = this.subscriptionObjects[messageId];
  else
    subscriptionObjects = this.subscriptionObjects[messageId] = {};

  function createFunction(nr, token, serializedTopic) {
    return function(id, err) {
      if (!(id in self.subscriptions))
        self.subscriptions[id] = {callbacks:{}, lastValueHandler:lastValueHandler};
      self.subscriptions[id].callbacks[token] = [publishCallback, nr];
      self.subscriptionTokens[token] = [subscriptionObjects, serializedTopic];
      subscriptionObjects[serializedTopic].count++;
      rr[nr] = err;
      ata[nr] = id;

      if (!--remaining)
        self.catchThrow(resultCallback, ata, rr);
    };
  }

  for (var i = 0; i < topic.length; ++i) {
    var token = self.nextSubscriptionToken++;
    var serializedTopic = serializeToString(topic[i]);
    var subscibedFunction = createFunction(i, token, serializedTopic);

    if (serializedTopic in subscriptionObjects) {
      var id = subscriptionObjects[serializedTopic].id;
      if (id) {
        var obj = self.subscriptions[id];
        subscibedFunction(id);
        if ("lastValue" in obj)
          publishCallback(obj.lastValue, i);
        if ("lastValues" in obj) {
          for (var key in obj.lastValues) {
            if (obj.lastValues.hasOwnProperty(key))
              publishCallback(obj.lastValues[key], i);
          }
        }
      } else
        subscriptionObjects[serializedTopic].onsubscribed.push(subscibedFunction);
    } else {
      needToSubscribeTp.push(topic[i]);
      needToSubscribeCb.push(subscriptionObjects[serializedTopic] = {
        count: 0,
        id: 0,
        onsubscribed: [subscibedFunction]
      });
    }

    ret.push(token);
  }

  if (needToSubscribeTp.length) {
    this.callMethod(messageId, needToSubscribeTp, function(data, err) {
      for (var i = 0; i < data.length; ++i) {
        var obj = needToSubscribeCb[i];
        obj.id = data[i];
        for (var j = 0; j < obj.onsubscribed.length; ++j)
          obj.onsubscribed[j](data[i], err[i]);
      }
    });
  }
  return ret;
};

Wpcp.prototype.unsubscribe = function(token, resultCallback) {
  var ids = [];
  var fullErr = new Array(token.length);
  var fullData = new Array(token.length);
  var idMapping = [];
  var self = this;

  for (var i = 0; i < token.length; ++i) {
    var subscriptionObjectArr = this.subscriptionTokens[token[i]];
    delete this.subscriptionTokens[token[i]];

    var subscriptionObject = subscriptionObjectArr[0][subscriptionObjectArr[1]];
    if (subscriptionObject && subscriptionObject.id) {
      var id = subscriptionObject.id;
      var subscriptionCalbacks = this.subscriptions[id].callbacks;
      delete subscriptionCalbacks[token[i]];

      if (!Object.getOwnPropertyNames(subscriptionCalbacks).length)
        delete this.subscriptions[id];

      if (!(--subscriptionObject.count)) {
        ids.push(id);
        idMapping.push(i);

        delete subscriptionObjectArr[0][subscriptionObjectArr[1]];
      } else
        fullData[i] = subscriptionObject.count + 1;
    } else
      fullData[i] = 0;
  }

  if (!ids.length) {
    self.catchThrow(resultCallback, fullData, fullErr);
    return;
  }

  this.callMethod("unsubscribe", ids, function(data, err) {
    for (var i = 0; i < data.length; ++i) {
      var nr = idMapping[i];
      if (!data[i])
        console.error("Can not unsubscribe");

      fullErr[nr] = err[i];
      fullData[nr] = data[i];
    }
    self.catchThrow(resultCallback, fullData, fullErr);
  });
};

Wpcp.prototype.browse = function(args, resultCallback, progressCallback) {
  return this.callMethod("browse", args, resultCallback, progressCallback);
};

Wpcp.prototype.handleAlarm = function(args, resultCallback, progressCallback) {
  return this.callMethod("handlealarm", args, resultCallback, progressCallback);
};

Wpcp.prototype.readData = function(args, resultCallback, progressCallback) {
  return this.callMethod("readdata", args, resultCallback, progressCallback);
};

Wpcp.prototype.readHistoryAlarm = function(args, resultCallback, progressCallback) {
  return this.callMethod("readhistoryalarm", args, resultCallback, progressCallback);
};

Wpcp.prototype.readHistoryData = function(args, resultCallback, progressCallback) {
  return this.callMethod("readhistorydata", args, resultCallback, progressCallback);
};

Wpcp.prototype.writeData = function(args, resultCallback, progressCallback) {
  return this.callMethod("writedata", args, resultCallback, progressCallback);
};

Wpcp.prototype.subscribeAudit = function(args, resultCallback, publishCallback) {
  return this.subscribeInternal("subscribeaudit", args, resultCallback, publishCallback);
};

Wpcp.prototype.subscribeData = function(args, resultCallback, publishCallback) {
  return this.subscribeInternal("subscribedata", args, resultCallback, publishCallback);
};

Wpcp.prototype.subscribeAlarm = function(args, resultCallback, publishCallback) {
  return this.subscribeInternal("subscribealarm", args, resultCallback, publishCallback);
};

if (typeof define === "function" && define.amd) {
  define("wpcp/wpcp", ["cbor/cbor"], function(cbor) {
    wpcpCbor = cbor;
    return Wpcp;
  });
} else if (!global.Wpcp) {
  wpcpCbor = CBOR;
  global.Wpcp = Wpcp;
}

})(this);
