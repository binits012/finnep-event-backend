/* Company Confidential, Copyright (c) 2016 CRF Box, Ltd. All Rights Reserved. */
"use strict";

const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');
const TerserPlugin = require("terser-webpack-plugin");
const args = require('minimist')(process.argv.slice(2));
//== Set the correct environment (e.g. 'production')
let env = 'dev';
if (args.env) { env = args.env; }

let projectName = process.env.npm_package_name + '-' + process.env.npm_package_version;

module.exports = {
    target: "node",
    context: __dirname,
    mode: env === 'dev' ? 'development' : 'production',
    devtool: env === 'dev' ? "inline-sourcemap" : false,
    entry: ['@babel/polyfill', "./app.js"
    ],
    output: {
        path: __dirname + "/dist/" + projectName,
        filename: "app.min.js"
    },
    externals: { 'winston': 'require("winston")', 'bcrypt': 'require("bcrypt")' }, // put winston as an external lib since it doesn't work after webpack transforms and bundles it
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
        minimizer: [new TerserPlugin()]
    },
};
