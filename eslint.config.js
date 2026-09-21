import base from '@for/eslint-config';
import enginePurity from '@for/eslint-config/engine-purity';
import react from '@for/eslint-config/react';

export default [...base, ...enginePurity, ...react];
