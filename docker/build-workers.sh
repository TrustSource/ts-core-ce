#!/bin/bash

set -o errexit

printf "\n[-] Installing analysis and webhook worker dependencies...\n\n"

# workers/ is outside the Meteor bundle (.meteorignore). The image ships it next to the
# bundle with production dependencies only and without its tests.
rm -rf $APP_BUNDLE_FOLDER/workers
mkdir -p $APP_BUNDLE_FOLDER/workers
cd $APP_SOURCE_FOLDER/workers
cp package.json yarn.lock entry.js $APP_BUNDLE_FOLDER/workers/
cp -R analysis webhook $APP_BUNDLE_FOLDER/workers/

cd $APP_BUNDLE_FOLDER/workers
yarn install --frozen-lockfile --production --ignore-scripts
