# ChessGame-React
This chess game is built using React.js on the frontend, Node.js and Express.js on the backend.

The integrated frontend, local setup, tournament screens, realtime recovery and browser tests are documented in [chessclient/README.md](chessclient/README.md). The current theme is preserved throughout the new screens.

Tournament backend setup, rules, APIs, persistence, recovery, and tests are documented in [server/tournaments/README.md](server/tournaments/README.md).

Elo policy, eligible games, rating APIs and history are documented in [server/ratings/README.md](server/ratings/README.md).

The MySQL 8.4 database schema, safe migration tooling and database acceptance tests are documented in [database/README.md](database/README.md). The integrated `mysql2/promise` backend, setup, transaction boundaries, recovery and cutover limitations are documented in [server/sql/README.md](server/sql/README.md). `npm start` now requires explicit MySQL configuration and `SESSION_SECRET`; it never silently falls back to files.

To check the database package from the project root, run `npm run db:install` followed by `npm run db:check`. Live migration and integration-test commands require explicit MySQL environment configuration; see the database guide.

Project Setup : 

First initiate the node Server then run Client as per instructions provided
   
1. Server Side :

Instructions :

mkdir server

cd server

mkdir users

Copy paste the json files below for the users folder

Copy and paste the package.json in the project folder

npm install

Copy and paste all the code files below in the project folder

npm start


2. Client Side:

Instructions:

Make sure to setup the server first

mkdir chessclient

cd chessclient

mkdir src

Copy and paste the package.json

npm install

Copy and paste all the code files below in the src folder

npm start
