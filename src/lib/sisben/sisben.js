'use strict';

require('dotenv').config();

const fetch = require('node-fetch');
const FormData = require('form-data');
const { userNameHandler } = require('../../utils/utils');

const DEFAULT_SISBEN_SITE = 'https://reportes.sisben.gov.co/dnp_sisbenconsulta';
const DOCUMENT_TYPE_ALIASES = {
  cc: '3',
  cedula: '3',
  ceduladeciudadania: '3',
  cedula_de_ciudadania: '3',
  ti: '2',
  tarjetadeidentidad: '2',
  tarjeta_de_identidad: '2',
  rc: '1',
  registrocivil: '1',
  registro_civil: '1',
  ce: '4',
  ceduladeextranjeria: '4',
  cedula_de_extranjeria: '4',
  pep: '8',
  ppt: '9',
  permisoporespecialdepermanencia: '8',
  permisoespecialdepermanencia: '8',
  permiso_por_proteccion_temporal: '9',
  permisoporprotecciontemporal: '9',
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value) {
  if (!value) {
    return '';
  }

  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(
      /&([a-z]+);/gi,
      (match, entity) => namedEntities[entity.toLowerCase()] || match,
    );
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeHtmlValue(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(value)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  );
}

function getSisbenUrl() {
  return process.env.SISBEN_SITE || DEFAULT_SISBEN_SITE;
}

function normalizeDocumentType(type) {
  const normalizedType = String(type || '')
    .trim()
    .toLowerCase();

  if (/^[1-9]$/.test(normalizedType)) {
    return normalizedType;
  }

  if (DOCUMENT_TYPE_ALIASES[normalizedType]) {
    return DOCUMENT_TYPE_ALIASES[normalizedType];
  }

  throw new Error('Invalid document type');
}

function extractRequestToken(html) {
  const match = html.match(
    /name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/i,
  );

  if (!match) {
    throw new Error('Unable to get Sisben request token');
  }

  return match[1];
}

function getCookieHeader(response) {
  const rawCookies = response.headers.raw()['set-cookie'] || [];

  return rawCookies.map(cookie => cookie.split(';')[0]).join('; ');
}

function extractField(html, label) {
  const expression = new RegExp(
    `${escapeRegExp(label)}\\s*<\\/p>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`,
    'i',
  );
  const match = html.match(expression);

  if (!match) {
    return '';
  }

  return sanitizeHtmlValue(match[1]);
}

function extractGroup(html) {
  const groupMatch = html.match(/font-size:42px">\s*([^<]+)\s*<\/p>/i);

  return groupMatch ? sanitizeHtmlValue(groupMatch[1]) : '';
}

function extractGroupLabel(html) {
  const labelMatch = html.match(/font-size:18px">([\s\S]*?)<\/p>/i);

  return labelMatch ? sanitizeHtmlValue(labelMatch[1]) : '';
}

function extractNotFoundMessage(html) {
  const match = html.match(/html:\s*'([\s\S]*?)',\s*footer:/i);

  if (!match) {
    return '';
  }

  return sanitizeHtmlValue(match[1]);
}

async function callSisbenServer(identification, type) {
  const documentType = normalizeDocumentType(type);
  const documentNumber = String(identification || '').trim();
  const url = getSisbenUrl();
  const defaultHeaders = {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  };

  const initialResponse = await fetch(url, {
    headers: defaultHeaders,
  });

  if (!initialResponse.ok) {
    const error = new Error('Unable to load Sisben site');
    error.statusCode = initialResponse.status;
    throw error;
  }

  const initialHtml = await initialResponse.text();
  const requestToken = extractRequestToken(initialHtml);
  const cookieHeader = getCookieHeader(initialResponse);
  const form = new FormData();

  form.append('TipoID', documentType);
  form.append('documento', documentNumber);
  form.append('__RequestVerificationToken', requestToken);

  const submitResponse = await fetch(url, {
    method: 'POST',
    body: form,
    headers: {
      ...defaultHeaders,
      ...form.getHeaders(),
      Cookie: cookieHeader,
      Origin: 'https://reportes.sisben.gov.co',
      Referer: url,
    },
  });

  if (!submitResponse.ok) {
    const error = new Error('Unable to query Sisben data');
    error.statusCode = submitResponse.status;
    throw error;
  }

  return submitResponse.text();
}

async function getUserInfo(htmlResponse) {
  const decodedHtml = decodeHtmlEntities(htmlResponse);
  const identification = extractField(decodedHtml, 'Número de documento:');
  const notFoundMessage = extractNotFoundMessage(decodedHtml);

  if (!identification) {
    return {
      found: false,
      message: notFoundMessage || 'User not found in Sisben IV',
    };
  }

  const firstName = extractField(decodedHtml, 'Nombres:');
  const lastName = extractField(decodedHtml, 'Apellidos:');

  return {
    found: true,
    queryDate: extractField(decodedHtml, 'Fecha de consulta:'),
    recordCode: extractField(decodedHtml, 'Ficha:'),
    group: extractGroup(decodedHtml),
    groupLabel: extractGroupLabel(decodedHtml),
    firstName,
    lastName,
    fullname: userNameHandler(firstName, lastName),
    documentType: extractField(decodedHtml, 'Tipo de documento:'),
    identification,
    municipality: extractField(decodedHtml, 'Municipio:'),
    department: extractField(decodedHtml, 'Departamento:'),
    surveyDate: extractField(decodedHtml, 'Encuesta vigente:'),
    lastCitizenUpdate: extractField(
      decodedHtml,
      'Última actualización ciudadano:',
    ),
    lastAdminUpdate: extractField(
      decodedHtml,
      'Última actualización via registros administrativos:',
    ),
    officeAdministrator: extractField(decodedHtml, 'Nombre administrador:'),
    officeAddress: extractField(decodedHtml, 'Dirección:'),
    officePhone: extractField(decodedHtml, 'Teléfono:'),
    officeEmail: extractField(decodedHtml, 'Correo Electrónico:'),
  };
}

module.exports = {
  callSisbenServer,
  getUserInfo,
};
