const parseString = require('xml2js').parseString;
const request = require('request');
const URL = require('url');
const TR064_DESC_URL = '/tr64desc.xml';
const IGD_DESC_URL = '/igddesc.xml';
const PMR_DESC_URL = '/pmr/PersonalMessageReceiver.xml';
const d = require('./Device');

class TR064 {
  constructor(config){
    this.host = config.host;
    this.port = config.port;
    this.username = config.username;
    this.password = config.password;
    this.config = config;
  }

  initDevice(type){

    const self = this;
    let url;

    switch(type){
      case 'TR064':
        url = TR064_DESC_URL;
        break;
      case 'IGD':
        url = IGD_DESC_URL;
        break;
      case 'PMR':
        url = PMR_DESC_URL;
        break;
    }

    const nurl = 'http://' + self.host + ':' + self.port + url;
    return new Promise(function(resolve, reject){
      request(nurl, function(error, response, body) {
        if (!error && response.statusCode == 200) {
          parseString(body, { explicitArray: false }, function(err, result) {
            if (!err) {
              var devInfo = result.root.device;
              devInfo.host = self.host;
              devInfo.port = self.port;
              var path = URL.parse(nurl).pathname;
              devInfo.urlPart = path.substring(0, path.lastIndexOf('/'));
              const newDevice = new d.Device(devInfo, self.config);
              newDevice._parseServices()
                .then(result => {
                  resolve(result);
                })
                .catch(err => {
                  reject(err);
                });
            } else {
              reject(error);
            }
          });
        } else {
          reject(error);
        }
      });
    });

  }
}

exports.TR064 = TR064;
