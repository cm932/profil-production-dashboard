/// <reference types="vite/client" />
/** true в автономной сборке (данные вшиты), false в серверной (данные приходят с сервера после входа) */
declare const __STANDALONE__: boolean
/** true в запечатанной сборке: данные в странице зашифрованы, расшифровываются логином и паролем (tools/seal.js) */
declare const __SEALED__: boolean
