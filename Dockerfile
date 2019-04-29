FROM node:8.11
RUN echo; echo "Starting slack-anonymous"

ADD . ./

RUN npm install

WORKDIR ./

EXPOSE 5000

CMD ["npm", "start"]
