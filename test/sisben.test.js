const chai = require('chai');
const server = require('../src/app');
const chaiHttp = require('chai-http');
const expect = chai.expect;

chai.use(chaiHttp);

describe('SISBEN CONTROLLER', () => {
  const body = {
    identification: '1127601142',
    type: 3,
  };

  const url = `/sisben?identification=${body.identification}&type=${body.type}`;

  it('SISBEN WEB SCRAPPING [TEST]', function(done) {
    this.timeout(10000);

    chai
      .request(server)
      .get(url)
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        expect(res.status).to.equal(200);
        expect(res.body).to.property('found', true);
        expect(res.body).to.property('fullname');
        expect(res.body).to.property('group');
        expect(res.body).to.property('groupLabel');
        expect(res.body).to.property('identification');
        expect(res.body).to.property('department');
        done();
      });
  });
});
