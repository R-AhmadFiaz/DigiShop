import assert from 'node:assert/strict';
import test from 'node:test';

const {
  accountingActivationPermitted,
  accountingAvailable,
  accountingContext,
  accountingMode,
  developmentAccountingPermitted,
  enforceAccountingWrite,
  productionAccountingPermitted,
  productionPostingActive,
} = await import('../dist/utils/accountingActivation.js');

const names = [
  'NODE_ENV',
  'DIGISHOP_ENV',
  'BUSINESS_ACCOUNTING_DEVELOPMENT_ENABLED',
  'BUSINESS_ACCOUNTING_ENABLED',
  'BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED',
];

function withEnvironment(values, work) {
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try { work(); }
  finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test('explicit development accounting is integration mode and retains activation restrictions', () => {
  withEnvironment({
    NODE_ENV: 'development',
    DIGISHOP_ENV: 'development',
    BUSINESS_ACCOUNTING_DEVELOPMENT_ENABLED: 'true',
  }, () => {
    assert.equal(developmentAccountingPermitted(), true);
    assert.equal(accountingActivationPermitted(), true);
    assert.equal(accountingMode(), 'INTEGRATION_TEST');
    accountingContext.run({shopId: 'test-shop', state: 'ACTIVE', preparation: false}, () => {
      assert.equal(accountingAvailable(), true);
      assert.equal(productionPostingActive(), false);
      assert.doesNotThrow(() => enforceAccountingWrite('ACTIVE', false, true));
    });
    assert.throws(() => enforceAccountingWrite('PAUSED', true, true), /paused/i);
    assert.throws(() => enforceAccountingWrite('PREPARING', false, true), /setup is in progress/i);
  });
});

test('development flag cannot enable accounting in production; production gate remains unchanged', () => {
  withEnvironment({
    NODE_ENV: 'production',
    DIGISHOP_ENV: 'development',
    BUSINESS_ACCOUNTING_DEVELOPMENT_ENABLED: 'true',
  }, () => {
    assert.equal(developmentAccountingPermitted(), false);
    assert.equal(productionAccountingPermitted(), false);
    assert.equal(accountingActivationPermitted(), false);
    accountingContext.run({shopId: 'test-shop', state: 'ACTIVE', preparation: false}, () => {
      assert.equal(accountingAvailable(), false);
      assert.equal(productionPostingActive(), false);
    });
    assert.throws(() => enforceAccountingWrite('ACTIVE', false, true), /server configuration/i);
  });
});

test('production accounting still requires both existing production flags', () => {
  withEnvironment({
    NODE_ENV: 'production',
    BUSINESS_ACCOUNTING_ENABLED: 'true',
    BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED: 'true',
  }, () => {
    assert.equal(productionAccountingPermitted(), true);
    assert.equal(accountingActivationPermitted(), true);
    assert.equal(accountingMode(), 'LIVE');
    accountingContext.run({shopId: 'test-shop', state: 'ACTIVE', preparation: false}, () => {
      assert.equal(accountingAvailable(), true);
      assert.equal(productionPostingActive(), true);
    });
  });
});
