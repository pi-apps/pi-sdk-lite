##
## BUILDER CONTAINER
##

# TODO: Bump node version?
FROM node:25.8.1 AS builder

ARG ENVIRONMENT

# Create both app dir and dist, the destination of the js bundle
RUN mkdir -p /app/dist

COPY ./package.json /app/package.json
COPY ./yarn.lock /app/yarn.lock
COPY ./tsconfig.json /app/tsconfig.json

WORKDIR /app

RUN yarn install

# Copy the resources needed to build the app bundle
COPY ./src /app/src
COPY ./webpack.config.js /app/webpack.config.js

# Create /app/dist/sdklite.js
RUN NODE_ENV=$ENVIRONMENT yarn build

##
## RUNNER CONTAINER
##

# Use the official Nginx image from the Docker Hub
FROM nginx:alpine

ARG ENVIRONMENT

COPY ./docker/nginx.conf /etc/nginx/conf.d/default.conf

RUN mkdir -p /var/www

COPY --from=builder /app/dist/sdklite.js /var/www/sdklite.js

# Default nginx configuration has only one worker process running. "Auto" is a better setting.
# Commenting out any existing setting, and adding the desired one is more robust against new docker image versions.
RUN sed -i  "s/worker_processes/#worker_processes/" /etc/nginx/nginx.conf && \
    echo "worker_processes auto;" >> /etc/nginx/nginx.conf && \
    echo "worker_rlimit_nofile 16384;" >> /etc/nginx/nginx.conf

# Copy the contents of the current directory to the /html directory in the container
COPY . /usr/share/nginx/html

# Expose port 80 to the outside world
EXPOSE 80
