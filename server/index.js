const { DocHelperApp } = require('./app.js');
const config = require('./config.js');

const app = new DocHelperApp();
const port = process.env.PORT ? Number(process.env.PORT) : config.load().port;

app.listen(port).then(() => {
  console.log(`Doc-Helper 已启动: http://localhost:${port}`);
});
