FROM node:20-alpine

COPY ["package.json", "package-lock.json","./"]

RUN npm install --fronzen-lockfile --verbose

CMD ["npm", "run",  "dist"]

COPY dist/yellowbridge*/*  /dist/
COPY .env  dist/ 

COPY node_modules  /dist/node_modules
WORKDIR /dist

RUN mkdir /dist/logs
RUN chmod -R 777 /dist/logs

EXPOSE 3000

CMD ["node", "app.min.js"]