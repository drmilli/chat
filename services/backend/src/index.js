require('dotenv').config();
const app = require('./app');

const port = process.env.PORT || 3000;

// A rejected promise somewhere in a handler should not take the API down with
// it. Run under a supervisor in production so genuine crashes still restart.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (service continues):', reason);
});

app.listen(port, () => {
  console.log(`Backend service listening on http://localhost:${port}`);
});
