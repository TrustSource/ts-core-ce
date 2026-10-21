SearchSource = {};
SearchSource._sources = {};
var bodyParser = Npm.require('body-parser');

SearchSource.defineSource = function(name, callback) {
  SearchSource._sources[name] = callback;
};

Meteor.methods({
  "search.source": async function(name, query, options) {
    check(name, String);
    check(query, Match.OneOf(String, null, undefined));
    check(options, Match.OneOf(Object, null, undefined));
    this.unblock();

    return await getSourceData.call(this, name, query, options);
  }
});

// Use WebApp.connectHandlers instead of meteorhacks:picker
WebApp.connectHandlers.use('/_search-source', bodyParser.text({
  type: "text/ejson"
}));

WebApp.connectHandlers.use('/_search-source', async function(req, res, next) {
  if(req.method === "POST" && req.body) {
    var payload = EJSON.parse(req.body);
    try {
      var data = await getSourceData(payload.source, payload.query, payload.options);
      sendData(res, null, data);
    } catch(ex) {
      if(ex instanceof Meteor.Error) {
        var error = { code: ex.error, message: ex.reason };
      } else {
        var error = { message: ex.message };
      }
      sendData(res, error);
    }
  } else {
    next();
  }
});


function sendData(res, err, data) {
  var payload = {
    error: err,
    data: data
  };

  res.end(EJSON.stringify(payload));
}

async function getSourceData(name, query, options) {
  var source = SearchSource._sources[name];
  if(source) {
    return await source.call(this, query, options);
  } else {
    throw new Meteor.Error(404, "No such search source: " + name);
  }
}
