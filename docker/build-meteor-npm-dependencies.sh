#!/bin/bash
set -o errexit
printf "\n[-] Installing Meteor application server NPM dependencies...\n\n"
cd $APP_BUNDLE_FOLDER/programs/server/
yarn
if [[ "$1" = '--build-from-source' ]]; then
	npm rebuild --build-from-source
	cd $APP_BUNDLE_FOLDER/programs/server/npm
	npm rebuild --build-from-source
fi
