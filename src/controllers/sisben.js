'use strict';

require('dotenv').config();

const { callSisbenServer, getUserInfo } = require('../lib/sisben/sisben');

async function getSisbenInfo(req, res) {
  try {
    const { identification, type } = req.query;

    if (!identification || !type) {
      return res
        .status(400)
        .send({ error: 'identification and type are required' });
    }

    const htmlResponse = await callSisbenServer(identification, type);
    const user = await getUserInfo(htmlResponse);
    res.status(200).send(user);
  } catch (err) {
    res.status(err.statusCode || 500).send({ error: err.message });
  }
}

module.exports = {
  getSisbenInfo,
};
