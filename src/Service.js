var parseString = require('xml2js').parseString;
var request = require('request');

class Service{
  constructor(device, serviceInfo, config, callback){
    this.host = device.meta.host;
    this.port = device.meta.port;
    this.device = device;
    this.meta = serviceInfo;
    this.meta.actionsInfo = [];
    this.readyCallback = callback;
    this.actions = {};
    this.stateVariables = {};
    this.logAttempts = [];
    this.config = config;
    this._parseSCPD(this);
  }

  _pushArg(argument, inArgs, outArgs){
    if (argument.direction == 'in') {
      inArgs.push(argument.name);
    } else if (argument.direction == 'out') {
      outArgs.push(argument.name);
    }
  }

  _parseActions(actionData){
    const self = this;
    if (!Array.isArray(actionData)) {
      return;
    }
    var insA = self._insertAction.bind(this);
    actionData.forEach(insA);
  }

  _parseSCPD(obj){
    const self = this;
    if (obj.device.meta.urlPart && obj.device.meta.urlPart.length > 0) {
      obj.meta.SCPDURL = obj.device.meta.urlPart + '/' + obj.meta.SCPDURL;
    }
    var url = 'http://' + obj.host + ':' + obj.port + obj.meta.SCPDURL;
    //console.log(url);
    request(url, function(error, response, body) {
      if (!error && response.statusCode == 200) {
        // console.log(body);
        parseString(
          body,
          {
            explicitArray: false,
          },
          function(err, result) {
            var pA = self._parseActions.bind(obj);
            var pV = self._parseStateVariables.bind(obj);
            pA(result.scpd.actionList.action);
            pV(result.scpd.serviceStateTable.stateVariable);
            //inspect(obj.stateVariables);
            obj.readyCallback(null, obj);
          }
        );
      } else {
        obj.readyCallback(error, null);
      }
    });
  }

  _insertAction(el){
    const self = this;
    var outArgs = [];
    var inArgs = [];
    if (el.argumentList && Array.isArray(el.argumentList.argument)) {
      el.argumentList.argument.forEach(function(argument) {
        self._pushArg(argument, inArgs, outArgs);
      });
    } else if (el.argumentList) {
      self._pushArg(el.argumentList.argument, inArgs, outArgs);
    }

    this.meta.actionsInfo.push({
      name: el.name,
      inArgs: inArgs,
      outArgs: outArgs,
    });

    this.actions[el.name] = self.bind(this, function(vars, callback) {
      this._callAction(el.name, inArgs, outArgs, vars, callback);
    });

  }

  bind(scope, fn) {
    return function() {
      return fn.apply(scope, arguments);
    };
  }

  _callAction(name, inArguments, outArguments, vars, callback){
    if (typeof vars === 'function') {
      callback = vars;
      vars = [];
    }

    this.bind(
      this,
      this._sendSOAPActionRequest(
        this.device,
        this.meta.controlURL,
        this.meta.serviceType,
        name,
        inArguments,
        outArguments,
        vars,
        callback
      )
    );
  }

  _insertStateVariables(sv){
    if (sv.$.sendEvents == 'yes') {
      this.stateVariables[sv.name] = this.bind(this, function(callback) {
        this._subscribeStateVariableChangeEvent(sv, callback);
      });
    }
  }

  _parseStateVariables(stateVariableData){
    var insSV = this.bind(this, this._insertStateVariables);
    if (Array.isArray(stateVariableData)) {
      stateVariableData.forEach(insSV);
    } else if (typeof stateVariableData === 'object') {
      insSV(stateVariableData);
    }
  }

  _sendSOAPActionRequest(device,url,serviceType,action,inArguments,outArguments,vars,callback){
    const self = this;
    var head = '';
    if (device._auth.uid) {
      // Content Level Authentication
      if (device._auth.auth) {
        head = '<s:Header>' +
               '<h:ClientAuth xmlns:h="http://soap-authentication.org/digest/2001/10/"' +
               's:mustUnderstand="1">' +
               '<Nonce>' +
               device._auth.sn +
               '</Nonce>' +
               '<Auth>' +
               device._auth.auth +
               '</Auth>' +
               '<UserID>' +
               device._auth.uid +
               '</UserID>' +
               '<Realm>' +
               device._auth.realm +
               '</Realm>' +
               '</h:ClientAuth>' +
               '</s:Header>';
      } else {
        // First Auth
        head = ' <s:Header>' +
               '<h:InitChallenge xmlns:h="http://soap-authentication.org/digest/2001/10/"' +
               's:mustUnderstand="1">' +
               '<UserID>' +
               device._auth.uid +
               '</UserID>' +
               '<Realm>' +
               device._auth.realm +
               '</Realm>' +
               '</h:InitChallenge>' +
               '</s:Header>';
      }
    }

    var body = '<?xml version="1.0" encoding="utf-8"?>' +
               '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s=" http://schemas.xmlsoap.org/soap/envelope/">' +
               head +
               '<s:Body>' +
               '<u:' +
               action +
               ' xmlns:u="' +
               serviceType +
               '">';

    for (var i in vars) {
      body += '<' + vars[i].name + '>';
      body += vars[i].value;
      body += '</' + vars[i].name + '>';
    }

    body = body + '</u:' + action + '>' + '</s:Body>' + '</s:Envelope>';

    var port = 0,
      proto = '',
      agentOptions = null;
    if (device._sslPort) {
      port = device._sslPort;
      proto = 'https://';
      if (device._ca) {
        agentOptions = {
          ca: device._ca,
        };
      } else {
        agentOptions = {
          rejectUnauthorized: false,
        }; // Allow selfsignd Certs
      }
    } else {
      proto = 'http://';
      port = device.meta.port;
    }
    var uri = proto + device.meta.host + ':' + port + url;
    var that = this;

    request(
      {
        method: 'POST',
        uri: uri,
        agentOptions: agentOptions,
        headers: {
          SoapAction: serviceType + '#' + action,
          'Content-Type': 'text/xml; charset="utf-8"',
        },
        body: body,
        timeout: self.config.timeout,
      },
      function(error, response, body) {
        if (!error && response.statusCode == 200) {
          parseString(
            body,
            {
              explicitArray: false,
            },
            function(err, result) {
              var challange = false;
              var res = {};
              var env = result['s:Envelope'];
              if (env['s:Header']) {
                var header = env['s:Header'];
                if (header['h:Challenge']) {
                  var ch = header['h:Challenge'];
                  challange = true;
                  if (self.logAttempts.length) {
                    for (const i in self.logAttempts) {
                      if ((self.logAttempts[i].service == serviceType && self.logAttempts[i].action == action)) {
                        if (self.logAttempts[i].attempts >= 1) {
                          error = new Error('Credentials incorrect');
                        } else {
                          self.logAttempts[i].attempts += 1;
                          device._auth.des = serviceType;
                          device._auth.sn = ch.Nonce;
                          device._auth.realm = ch.Realm;
                          device._auth.auth = device._calcAuthDigest(
                            device._auth.uid,
                            device._auth.pwd,
                            device._auth.realm,
                            device._auth.sn
                          );
                          device._auth.chCount++;
                          that._sendSOAPActionRequest(
                            device,
                            url,
                            serviceType,
                            action,
                            inArguments,
                            outArguments,
                            vars,
                            callback
                          );
                          return;
                        }
                      }
                    }
                  } else {
                    self.logAttempts.push({ service: serviceType, action: action, attempts: 1 });
                    device._auth.sn = ch.Nonce;
                    device._auth.realm = ch.Realm;
                    device._auth.auth = device._calcAuthDigest(
                      device._auth.uid,
                      device._auth.pwd,
                      device._auth.realm,
                      device._auth.sn
                    );
                    device._auth.chCount++;
                    // Repeat request.
                    that._sendSOAPActionRequest(
                      device,
                      url,
                      serviceType,
                      action,
                      inArguments,
                      outArguments,
                      vars,
                      callback
                    );
                    return;
                  }
                } else if (header['h:NextChallenge']) {
                  var nx = header['h:NextChallenge'];
                  for (const i in self.logAttempts) {
                    if ((self.logAttempts[i].service == serviceType && self.logAttempts[i].action == action)) {
                      self.logAttempts[i].attempts = 0;
                    }
                  }
                  device._auth.chCount = 0;
                  device._auth.sn = nx.Nonce;
                  device._auth.realm = nx.Realm;
                  device._auth.auth = device._calcAuthDigest(
                    device._auth.uid,
                    device._auth.pwd,
                    device._auth.realm,
                    device._auth.sn
                  );
                }
              }

              if (env['s:Body']) {
                var body = env['s:Body'];
                if (body['u:' + action + 'Response']) {
                  var responseVars = body['u:' + action + 'Response'];
                  if (outArguments) {
                    outArguments.forEach(function(arg) {
                      res[arg] = responseVars[arg];
                    });
                  }
                } else if (body['s:Fault']) {
                  var fault = body['s:Fault'];
                  //let errorStatus = body['s:Fault'].detail.UPnPError.errorDescription;
                  let newFault = body['s:Fault'];
                  error = {
                    tr064: newFault.detail.UPnPError.errorDescription,
                    tr064code: newFault.detail.UPnPError.errorCode,
                    fault: newFault.faultstring,
                    faultcode: newFault.faultcode,
                    serviceType: serviceType,
                    action: action
                  };
                  res = fault;
                }
              }
              callback(error, res);
            }
          );
        } else {
          parseString(body,{explicitArray: false,}, function (err, result) {
            if(!err){
              let env = result['s:Envelope'];
              if(env['s:Body']){
                let newBody = env['s:Body'];
                if(newBody['s:Fault']){
                  let fault = newBody['s:Fault'];
                  error = {
                    response: response.statusMessage,
                    responseCode: response.statusCode,
                    tr064: fault.detail.UPnPError.errorDescription,
                    tr064code: fault.detail.UPnPError.errorCode,
                    fault: fault.faultstring,
                    faultcode: fault.faultcode,
                    serviceType: serviceType,
                    action: action
                  };
                }
              }
            } else {
              error = {
                response: response.statusMessage,
                responseCode: response.statusCode,
                serviceType: serviceType,
                action: action
              };
            }
          });
          callback(error, null);
        }
      }
    );
  }
}

exports.Service = Service;
