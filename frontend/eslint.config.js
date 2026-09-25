/**
 * Ce que `tsc` ne voit pas.
 *
 * Le projet n'avait pas d'analyse statique au-dela du typage : `npm run lint`
 * n'etait qu'un alias de `tsc --noEmit`. Cela laissait passer deux familles de
 * fautes qui ne sont pas des fautes de TYPE mais d'ORDRE ou de REGLE, et qui se
 * paient a l'execution par un ecran blanc :
 *
 *   ZONE MORTE TEMPORELLE  `const` n'est pas remonte comme une fonction. Lire
 *                          `initiales.current` au rendu alors que la reference
 *                          est declaree trois cents lignes plus bas levait
 *                          « Cannot access 'initiales' before initialization »,
 *                          et React perdait tout le composant. `tsc` laissait
 *                          passer : l'acces etait dans une fonction flechee,
 *                          qu'il suppose executee plus tard.
 *
 *   REGLES DES HOOKS       un `useMutation` pose apres un retour anticipe, ou
 *                          dans une condition, change l'ordre des hooks d'un
 *                          rendu a l'autre. React s'arrete net.
 *
 * Le 25/09/2026, la premiere a coute une heure de diagnostic : trois
 * verifications vertes — types, construction, « lint » — et un ecran blanc.
 */
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `target` et `dist` ne sont pas du code ecrit : les analyser couterait des
  // minutes pour ne rien apprendre.
  { ignores: ['dist', 'src-tauri/target', 'dev-dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /* LA REGLE POUR LAQUELLE ON A INSTALLE TOUT CECI. `variables: true` est
         l'essentiel : c'est elle qui signale une reference lue avant sa
         declaration. `functions: false` parce qu'une declaration de fonction,
         elle, EST remontee — l'interdire obligerait a ranger le fichier dans
         l'ordre d'appel plutot que dans l'ordre de lecture, sans rien gagner. */
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': [
        'error',
        { functions: false, classes: true, variables: true, typedefs: false },
      ],

      /* AVERTISSEMENT, PAS ERREUR — un choix assume, pas une capitulation.
         `set-state-in-effect` reproche de synchroniser un etat React sur une
         donnee qui vient d'arriver du serveur : le formulaire d'en-tete qui se
         remplit quand le bon est charge, par exemple. C'est un conseil de
         performance (un rendu de plus), pas une faute de correction, et le
         motif est employe dans trente endroits du projet.
         Le laisser en erreur rendait `npm run lint` rouge en permanence — et
         un garde-fou toujours rouge ne garde plus rien : on cesse de le lire,
         donc on cesse de voir les vraies erreurs qu'il signale a cote. */
      'react-hooks/set-state-in-effect': 'warn',

      /* UN AVERTISSEMENT, PAS UNE ERREUR. Exporter autre chose qu'un composant
         depuis un fichier de composant casse le rechargement a chaud, ce qui
         est genant sans etre faux — et `GrilleLignes.tsx` le fait deliberement
         pour partager `corpsLigne` avec les deux ecrans de saisie. */
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* `_` EN PREFIXE VEUT DIRE « JE SAIS ». Un parametre impose par une
         signature qu'on n'utilise pas n'est pas une faute ; le renommer pour
         faire taire l'outil serait pire que le silence. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
)
