#!/bin/bash
set -o errexit
printf "\n[-] Building Meteor application bundle...\n\n"
cd $APP_SOURCE_FOLDER
meteor build --allow-superuser --directory $APP_BUNDLE_FOLDER --server-only --architecture os.linux.x86_64
