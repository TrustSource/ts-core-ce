import {Meteor} from 'meteor/meteor';
import {httpCall} from '/imports/lib/httpFetch';
import {Config} from '/imports/server/config';

function getApiParams(data) {
  const urlBase = Config.TS_CHECK_SERVER;
  const options = {
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if(Config.DEBUG_MODE_ENABLED){
    console.log(`=> ts-check details ${JSON.stringify({url: urlBase, options})}`);
  }

  if (data) {
    options.data = data;
  }

  return {url: urlBase, options};
}

// Proxy a module check to the external ECS check server. Kept as a plain
// function so trusted server code (checkLicense/checkComponent methods) can
// call it directly: a nested Meteor.call would inherit the caller's DDP
// connection and trip the denyDDP guard on the tsCheck method below.
export async function runTsCheck(data) {
  const startTime = new Date();
  const {url, options} = getApiParams(data);
  let request;
  try {
    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> tsCheck request: ', JSON.stringify(options));
    }
    request = await httpCall('POST', url + 'check-module', options);
    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> tsCheck response: ', JSON.stringify(request && request.data));
    }
  } catch (error) {
    console.info('=> tsCheck: ', error);
    if(error.code === 'ECONNREFUSED' || error.Error && error.Error.indexOf('ETIMEDOUT') > -1){
      throw new Meteor.Error(error, 'Service is not available');
    }else{
      throw new Meteor.Error(error, error.reason);
    }
  }
  console.info('=> TSCheck: took %s millis', new Date() - startTime);
  return request;
}
