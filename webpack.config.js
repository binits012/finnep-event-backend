"use strict";
import webpack from 'webpack'
import CopyWebpackPlugin from 'copy-webpack-plugin'
const __dirname = import.meta.dirname;
import TerserPlugin from 'terser-webpack-plugin'
import minimist from 'minimist'
const args = minimist(process.argv.slice(2));


 console.log(__dirname)
//== Set the correct environment (e.g. 'production')
let env = 'dev';
if (args.env) { env = args.env; }

let projectName = process.env.npm_package_name + '-' + process.env.npm_package_version;

export default {
    target: "node",
    context: __dirname,
    mode: env === 'dev' ? 'development' : 'production',
    devtool:  "source-map",
    entry: ['@babel/polyfill', "./app.js"
    ],
    output: {
        path: __dirname + "/dist/" + projectName,
        filename: "app.min.js"
    },
    externals: [function(context, request, callback) {
        if (/winston|bcrypt/.test(request)) {
          callback(null, {
            // Use a dynamic ESM import statement
            local: 'import("' + request + '").then(mod => mod.default || mod)',
            external: request,
          });
        } else {
          callback();
        }
      }], // put winston as an external lib since it doesn't work after webpack transforms and bundles it
    module: {
        rules: [{
            test: /\.jsx?$/,
            exclude: /(node_modules|bower_components)/,
            loader: 'babel-loader',
            options: {
                presets: ['@babel/preset-env']
            }
        }
        ],
    },
    plugins: env === 'dev' ? [] : [
        new webpack.IgnorePlugin({
            resourceRegExp: /^electron$/
        })
    ],
    node: {
        global: false,
        __filename: false,
        __dirname: false,
    },
    optimization: {
        minimize: true,
        minimizer: [
          new TerserPlugin({
            terserOptions:{
                compress: {
                    keep_fnames: true,
                  },
            } 
          }),
        ],
      }
};
