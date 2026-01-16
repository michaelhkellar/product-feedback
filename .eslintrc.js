module.exports = {
	root: true,
	env: {
		node: true,
		es2021: true,
	},
	parserOptions: {
		ecmaVersion: 2021,
		sourceType: 'module',
	},
	extends: ['plugin:n8n-nodes-base/community', 'prettier'],
};
