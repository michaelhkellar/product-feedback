import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BlumiraApi implements ICredentialType {
	name = 'blumiraApi';
	displayName = 'Blumira API';
	documentationUrl = 'https://api.blumira.com/public-api/v1/ui/';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'JWT access token without the Bearer prefix.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{$credentials.accessToken ? "Bearer " + $credentials.accessToken : undefined}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.blumira.com/public-api/v1',
			url: '/health',
			method: 'GET',
		},
	};
}
