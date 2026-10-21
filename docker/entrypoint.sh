#!/bin/bash

set -o errexit

cd $SCRIPTS_FOLDER

# Poll until we can successfully connect to MongoDB
echo "Connecting to MongoDB ..."
node <<- 'EOJS'
require('p-wait-for')(function() {
	return new Promise(function (resolve) {
		const { MongoClient } = require('mongodb');
		const client = new MongoClient(process.env.MONGO_URI);
		client.connect().then(function() {
			client.close();
			resolve(true);
		}).catch(function() {
			resolve(false);
		});
	});
}, 1000);
EOJS

export MONGO_URL=$MONGO_URI

echo 'Starting app...'
df -h
cd $APP_BUNDLE_FOLDER

exec "$@"
