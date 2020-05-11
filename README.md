e-trade
=======

[![npm license](https://img.shields.io/npm/l/e-trade.svg)](https://www.npmjs.com/package/e-trade) [![npm version](https://img.shields.io/npm/v/e-trade.svg)](https://www.npmjs.com/package/e-trade) [![npm downloads](https://img.shields.io/npm/dm/e-trade.svg)](https://www.npmjs.com/package/e-trade)

A promise, JSON-based library for interacting with the E-Trade API.

Written in TypeScript.

Install
-------
```
$ npm install e-trade
```

Example
-------
```typescript
import { ETrade } from 'e-trade';

const etrade = new ETrade({
    key: 'key',
    secret: 'secret'
});

(async () => {
    try {
		const requestTokenResults = await etrade.requestToken();
		
		// Visit url, authorize application, copy/paste code below

		const accessTokenResults = await etrade.getAccessToken({
			key: requestTokenResults.oauth_token
			secret: requestTokenResults.oauth_token_secret,
			code: 'code from requestTokenResults.url'
		});

        etrade.settings.accessToken = accessTokenResults.oauth_token;
		etrade.settings.accessSecret = accessTokenResults.oauth_token_secret;

        const results = await etrade.listAccounts();

        console.log(results[0].accountName);
    }catch(err){
        console.error(err);
    }
})();
```
