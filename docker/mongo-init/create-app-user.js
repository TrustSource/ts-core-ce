// Runs once, when the MongoDB volume is created (docker-entrypoint-initdb.d).
// Creates the user the app connects with: read/write on its own database only,
// so the app never holds the root account.
const dbName = process.env.MONGO_INITDB_DATABASE || 'meteor';
const user = process.env.MONGO_APP_USERNAME || 'trustsource';
const password = process.env.MONGO_APP_PASSWORD;

if (!password) {
  throw new Error('MONGO_APP_PASSWORD is not set');
}

db.getSiblingDB(dbName).createUser({
  user,
  pwd: password,
  roles: [{role: 'readWrite', db: dbName}]
});
