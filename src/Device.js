const async = require('async');
const crypto = require('crypto');
const s = require('./Service');

class Device {
  constructor(deviceInfo, config){
    this.config = config;
    this.meta = deviceInfo;
    this.meta.servicesInfo = [];
    this.services = {};
    this._isTransaction = false;
    this._parseServices();
    this._sslPort = null;
    this._auth = {
      uid: null,
      realm: 'F!Box SOAP-Auth',
      chCount: 0,
    };
  }

  login(user, password){
    if (password === undefined) {
      this._auth.uid = 'DefaultUser';
      this._auth.pwd = user;
    } else {
      this._auth.uid = user;
      this._auth.pwd = password;
    }
  }

  logout(){
    this._auth.uid = null;
    this._auth.pwd = null;
    this._auth.chCount = 0;
  }

  startEncryptedCommunication(){
    const self=this;

    return new Promise(function(resolve, reject){

      self._getSSLPort(function(err, port) {
        if (!err) {
          self._sslPort = port;
          resolve(self);
        } else {
          reject(err);
        }
      });

    });
  }

  stopEncryptedCommunication(){
    this._sslPort = null;
  }

  getServicesFromDevice(serviceArray, device){
    const self = this;
    serviceArray = serviceArray.concat(device.serviceList.service);
    if (device.deviceList && Array.isArray(device.deviceList.device)) {
      device.deviceList.device.forEach(function(dev) {
        serviceArray = self.getServicesFromDevice(serviceArray, dev);
      });
    } else if (device.deviceList && device.deviceList.device) {
      serviceArray = self.getServicesFromDevice(serviceArray, device.deviceList.device);
    }
    return serviceArray;
  }

  _parseServices(){
    const self = this;
    var serviceArray = self.getServicesFromDevice([], this.meta);
    var asyncAddService = self._addService.bind(this);

    return new Promise(function(resolve, reject){

      async.concat(serviceArray, asyncAddService, function(err, results){
        if(!err){
          for (var i in results) {
            var service = results[i];
            self.services[service.meta.serviceType] = service;
            self.meta.servicesInfo.push(service.meta.serviceType);
          }
          delete self.meta.deviceList;
          delete self.meta.serviceList;
          resolve(self);
        } else {
          reject(err);
        }
      });

    });

  }

  _addService(serviceData, callback){
    const self = this;
    new s.Service(this, serviceData, self.config, callback);
  }

  _getSSLPort(cb){
    var devInfo = this.services['urn:dslforum-org:service:DeviceInfo:1'];
    devInfo.actions.GetSecurityPort(function(err, result) {
      if (!err) {
        var sslPort = parseInt(result.NewSecurityPort);
        if (typeof sslPort === 'number' && isFinite(sslPort)) {
          cb(null, sslPort);
        } else {
          cb(new Error('Got bad port from Device. Port:' + result.NewSecurityPort));
        }
      } else {
        cb(new Error('Encription is not supported for this device.'));
      }
    });
  }

  _calcAuthDigest(uid, pwd, realm, sn){
    var MD5 = crypto.createHash('md5');
    MD5.update(uid + ':' + realm + ':' + pwd);
    var secret = MD5.digest('hex');
    MD5 = crypto.createHash('md5');
    MD5.update(secret + ':' + sn);
    return MD5.digest('hex');
  }
}

exports.Device = Device;
