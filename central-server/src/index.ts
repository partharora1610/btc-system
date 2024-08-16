import httpServer from 'apps/server';
import getEnvVar, { parseEnv } from 'env/index';
parseEnv();

httpServer.listen(parseInt(getEnvVar('PORT')), () => {
  console.log(`Server listening at ${getEnvVar('PORT')}`);
});
