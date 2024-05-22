import { NAMESPACES as ns } from '../env';

export default [
  {
    type: ns.ere`EredienstMandataris`,
    children: [
      {
        path: ns.mandaat`isBestuurlijkeAliasVan`,
        type: ns.person`Person`,
        children: [
          {
            path: ns.persoon`heeftGeboorte`,
            type: ns.persoon`Geboorte`,
          },
          {
            path: ns.adms`identifier`,
            type: ns.adms`Identifier`,
          },
        ],
      },
      {
        path: ns.schema`contactPoint`,
        type: ns.schema`ContactPoint`,
        children: [
          {
            path: ns.locn`address`,
            type: ns.locn`Address`,
          },
        ],
      },
    ],
  },
  {
    type: ns.ere`RolBedienaar`,
    children: [
      {
        path: ns.org`heldBy`,
        type: ns.person`Person`,
        children: [
          {
            path: ns.persoon`heeftGeboorte`,
            type: ns.persoon`Geboorte`,
          },
          {
            path: ns.adms`identifier`,
            type: ns.adms`Identifier`,
          },
        ],
      },
      {
        path: ns.schema`contactPoint`,
        type: ns.schema`ContactPoint`,
        children: [
          {
            path: ns.locn`address`,
            type: ns.locn`Address`,
          },
        ],
      },
    ],
  },
];
