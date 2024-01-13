// eslint-disable-next-line node/no-unpublished-require
const { SharePlugin } = require("../../../../").sharing;

/** @type {import("../../../../").Configuration} */
module.exports = {
	mode: "development",
	devtool: false,
	plugins: [
		new SharePlugin({
			shared: {
				lib1: {
					import: false,
					eager: true,
					singleton: true,
					version: "0",
					requiredVersion: "0"
				},
				lib2: {
					import: false,
					eager: true,
					singleton: true,
					version: "0",
					requiredVersion: "0"
				}
			}
		})
	]
};
