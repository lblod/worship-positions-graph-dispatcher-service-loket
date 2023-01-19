import { NAMESPACES as ns } from '../env';

/*
 * This file is used to construct queries to get the administrative unit a
 * piece of data is related to. The prefixes used can be found in the `env.js`
 * file.
 *
 * NOTE: make sure to use the full URI (no prefixes) for the `type` property.
 */

export default [
  {
    type: ns.ere`EredienstMandataris`,
    pathToWorshipAdminUnit: `
      ?subject
        org:holds ?mandate .
      ?orgaanInTime
        org:hasPost ?mandate ;
        mandaat:isTijdspecialisatieVan ?orgaan .
      ?orgaan
        besluit:bestuurt ?worshipAdministrativeUnit .
    `,
  },
  {
    type: ns.ere`RolBedienaar`,
    pathToWorshipAdminUnit: `
      ?subject
        org:holds ?position .
      ?worshipAdministrativeUnit
        ere:wordtBediendDoor ?position .
    `,
  },
  {
    // Person linked to a EredienstMandataris
    type: ns.person`Person`,
    pathToWorshipAdminUnit: `
      ?mandataris
        mandaat:isBestuurlijkeAliasVan ?subject ;
        org:holds ?mandate .
      ?orgaanInTime
        org:hasPost ?mandate ;
        mandaat:isTijdspecialisatieVan ?orgaan .
      ?orgaan
        besluit:bestuurt ?worshipAdministrativeUnit .
    `,
  },
  {
    // Person linked to a RolBedienaar
    type: ns.person`Person`,
    pathToWorshipAdminUnit: `
      ?minister
        org:heldBy ?subject ;
        org:holds ?position .
      ?worshipAdministrativeUnit
        ere:wordtBediendDoor ?position .
    `,
  },
  {
    // Birthdate of person linked to a EredienstMandataris
    type: ns.persoon`Geboorte`,
    pathToWorshipAdminUnit: `
      ?person
        persoon:heeftGeboorte ?subject .
      ?mandataris
        mandaat:isBestuurlijkeAliasVan ?person ;
        org:holds ?mandate .
      ?orgaanInTime
        org:hasPost ?mandate ;
        mandaat:isTijdspecialisatieVan ?orgaan .
      ?orgaan
        besluit:bestuurt ?worshipAdministrativeUnit .
    `,
  },
  {
    // Birthdate of person linked to a RolBedienaar
    type: ns.persoon`Geboorte`,
    pathToWorshipAdminUnit: `
      ?person
        persoon:heeftGeboorte ?subject .
      ?minister
        org:heldBy ?person ;
        org:holds ?position .
      ?worshipAdministrativeUnit
        ere:wordtBediendDoor ?position .
    `,
  },
  {
    // Id of person linked to a EredienstMandataris
    type: ns.adms`Identifier`,
    pathToWorshipAdminUnit: `
      ?person
        adms:identifier ?subject .
      ?mandataris
        mandaat:isBestuurlijkeAliasVan ?person ;
        org:holds ?mandate .
      ?orgaanInTime
        org:hasPost ?mandate ;
        mandaat:isTijdspecialisatieVan ?orgaan .
      ?orgaan
        besluit:bestuurt ?worshipAdministrativeUnit .
    `,
  },
  {
    // Id of person linked to a RolBedienaar
    type: ns.adms`Identifier`,
    pathToWorshipAdminUnit: `
      ?person
        adms:identifier ?subject .
      ?minister
        org:heldBy ?person ;
        org:holds ?position .
      ?worshipAdministrativeUnit
        ere:wordtBediendDoor ?position .
    `,
  },
  {
    // Contact point linked to a EredienstMandataris
    type: ns.schema`ContactPoint`,
    pathToWorshipAdminUnit: `
      ?mandataris
        schema:contactPoint ?subject ;
        org:holds ?mandate .
      ?orgaanInTime
        org:hasPost ?mandate ;
        mandaat:isTijdspecialisatieVan ?orgaan .
      ?orgaan
        besluit:bestuurt ?worshipAdministrativeUnit .
    `,
  },
  {
    // Contact point linked to a RolBedienaar
    type: ns.schema`ContactPoint`,
    pathToWorshipAdminUnit: `
      ?minister
        schema:contactPoint ?subject ;
        org:holds ?position .
      ?worshipAdministrativeUnit
        ere:wordtBediendDoor ?position .
    `,
  },
  {
    // Address linked to a EredienstMandataris
    type: ns.locn`Address`,
    pathToWorshipAdminUnit: `
      ?address
        locn:address ?subject .
      ?mandataris
        schema:contactPoint ?address ;
        org:holds ?mandate .
      ?orgaanInTime
        org:hasPost ?mandate ;
        mandaat:isTijdspecialisatieVan ?orgaan .
      ?orgaan
        besluit:bestuurt ?worshipAdministrativeUnit .
    `,
  },
  {
    // Address linked to a RolBedienaar
    type: ns.locn`Address`,
    pathToWorshipAdminUnit: `
      ?address
        locn:address ?subject .
      ?minister
        schema:contactPoint ?address ;
        org:holds ?position .
      ?worshipAdministrativeUnit
        ere:wordtBediendDoor ?position .
    `,
  },
];
