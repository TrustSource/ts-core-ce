# The tag here should match the Meteor version of your app, per .meteor/release
FROM ubuntu:24.04

# Default Meteor version if not defined at build time; see ../build.sh
ARG METEOR_VERSION=3.5.2

ENV SCRIPTS_FOLDER=/docker
ENV APP_SOURCE_FOLDER=/opt/src
ENV APP_BUNDLE_FOLDER=/opt/bundle
ENV DEBIAN_FRONTEND=noninteractive

RUN groupadd meteor && useradd -ms /bin/bash -g meteor meteor && \
    mkdir --parents $APP_BUNDLE_FOLDER $APP_SOURCE_FOLDER  $SCRIPTS_FOLDER && \
    chown -R meteor.meteor $APP_BUNDLE_FOLDER $APP_SOURCE_FOLDER $SCRIPTS_FOLDER

# Install dependencies, based on https://github.com/jshimko/meteor-launchpad/blob/master/scripts/install-deps.sh (only the parts we plan to use)
# libarchive-tools replaced bsdtar
RUN apt-get update && \
	apt-get install --assume-yes apt-transport-https ca-certificates && \
	apt-get install --assume-yes --no-install-recommends build-essential libarchive-tools bzip2 curl git python3

## install node (Meteor 3 requires Node 20+)
RUN curl -sL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y  gcc g++ make nodejs && \
    npm i -g yarn

## USER scope from here
USER meteor

# Install Meteor
RUN curl https://install.meteor.com/?release=$METEOR_VERSION --output /tmp/install-meteor.sh && \
	# Replace tar with bsdtar in the install script; https://github.com/jshimko/meteor-launchpad/issues/39
	sed --in-place "s/tar -xzf.*/bsdtar -xf \"\$TARBALL_FILE\" -C \"\$INSTALL_TMPDIR\"/g" /tmp/install-meteor.sh && \
	# Install Meteor
	printf "\n[-] Installing Meteor $METEOR_VERSION...\n\n" && \
	sh /tmp/install-meteor.sh

ENV PATH="/home/meteor/.meteor:${PATH}"

# Copy entrypoint and dependencies
COPY --chown=meteor:meteor ./docker $SCRIPTS_FOLDER/

# Install entrypoint dependencies (npm ci for reproducible installs)
RUN cd $SCRIPTS_FOLDER && npm ci

#############################################################################
## Application specific parts start here (creating deployment artifact)
## Everything above might be put into a base image (node and meteor install)
#############################################################################

# Copy app package.json and package-lock.json into container
COPY --chown=meteor:meteor . $APP_SOURCE_FOLDER/

RUN bash $SCRIPTS_FOLDER/build-app-npm-dependencies.sh

RUN bash $SCRIPTS_FOLDER/build-meteor-bundle.sh

# Analysis and webhook workers run in worker threads from a folder outside the Meteor bundle
RUN bash $SCRIPTS_FOLDER/build-workers.sh

############################################################################
## Image building using the deployment created above (based on slim alpine)
############################################################################

# Meteor 3 requires Node 20+; using Node 24
FROM node:24-alpine

ENV APP_BUNDLE_FOLDER=/opt/bundle
ENV SCRIPTS_FOLDER=/docker

# Runtime base packages
RUN apk --no-cache add \
		bash \
		ca-certificates

RUN addgroup -S meteor && adduser -S meteor -G meteor

# Copy in entrypoint
COPY --from=0 --chown=meteor:meteor $SCRIPTS_FOLDER $SCRIPTS_FOLDER/

# Copy in app bundle
COPY --from=0 --chown=meteor:meteor $APP_BUNDLE_FOLDER/bundle $APP_BUNDLE_FOLDER
COPY --from=0 --chown=meteor:meteor /opt/src/LICENSE /opt/src/NOTICE $APP_BUNDLE_FOLDER/

# Analysis and webhook workers (TS_WORKERS_DIR defaults to /opt/workers)
COPY --from=0 --chown=meteor:meteor $APP_BUNDLE_FOLDER/workers /opt/workers

# Install server npm deps with a temporary build toolchain (native modules
# such as bcrypt); add and remove the toolchain in one layer so compilers
# don't ship in the final image
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
	&& su -s /bin/bash meteor -c "bash $SCRIPTS_FOLDER/build-meteor-npm-dependencies.sh" \
	&& apk del .build-deps

RUN mkdir -p /app.storage/files && /bin/chown -R meteor:meteor /app.storage/files

# Uploaded and generated files (notices, product documents, SPDX, imports, policies).
# Mount a volume here; app containers that share it share their files.
VOLUME /app.storage/files

USER meteor

EXPOSE 3000

# Start app
ENTRYPOINT ["/docker/entrypoint.sh"]

CMD ["node", "main.js"]
