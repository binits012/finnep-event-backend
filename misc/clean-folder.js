"use strict";

const fs = require('fs-extra');
const args = require('minimist')(process.argv.slice(2));

if (args.folder) {
    fs.remove(args.folder, function (err) {
        /* ignore error */
    });
} else {
    console.error('Folder not specified, so skipping to clean the folder.');
}