module.exports = {
	"host": "0.0.0.0",
	"port": 7777,

	"keyLength": 10,
	"maxLength": 400000,

	"keyGenerator": {
		"type": "phonetic"
	},

	"staticMaxAge": 60 * 60 * 24,

	"logging": {
		"level": "info"
	},

	"rateLimits": {
		"windowMs": 30 * 60 * 1000,
		"max": 500
	},

	"storage": {
		"type": "redis",
		"expire": 31536000,
		"redisOptions": {
			"host": "redis",
			"port": 6379,
			"db": 2
		}
	},

	"documents": {
		"about": "./about.md"
	}
};
