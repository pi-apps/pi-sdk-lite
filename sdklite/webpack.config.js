const path = require("path");
const webpack = require("webpack");

const BACKEND_URLS = {
  development: "http://localhost:3005",
  staging:
    "https://backend.appstudio-pobr34hy4r0qmyuu.staging.piappengine.com",
  production: "https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com",
};

module.exports = (env = {}) => {
  const target = env.target || "development";
  const isDev = target === "development";

  const backendUrl = process.env.SDKLITE_BACKEND_URL || BACKEND_URLS[target];
  if (!backendUrl) {
    throw new Error(
      `Unknown target "${target}". Use: development, staging, production (or set SDKLITE_BACKEND_URL).`
    );
  }

  return {
    mode: isDev ? "development" : "production",
    entry: "./src/sdklite.ts",
    devtool: isDev ? "eval-source-map" : false,
    target: "web",
    output: {
      filename: `sdklite-${target}.js`,
      path: path.resolve(__dirname, "dist"),
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    plugins: [
      new webpack.DefinePlugin({
        __SDKLITE_BACKEND_URL__: JSON.stringify(backendUrl),
      }),
    ],
  };
};
