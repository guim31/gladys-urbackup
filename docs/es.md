# UrBackup

[UrBackup](https://www.urbackup.org/) es un sistema libre de copias de
seguridad cliente/servidor: un servidor copia los archivos (y, en Windows, las
imágenes de disco) de los ordenadores de su casa u oficina. Esta integración
lleva los clientes de un servidor UrBackup a Gladys: cada cliente (un
ordenador copiado) se convierte en un dispositivo con su estado, si está en
línea, sus últimas copias de archivos y de imagen, la copia en curso y su
progreso. Las escenas pueden reaccionar cuando **cualquier** copia se completa,
falla o tiene retraso, un widget del panel muestra primero los clientes
fallidos, y una escena puede iniciar una copia incremental de archivos.

Probada con un servidor UrBackup 2.5 real (imagen Docker
`uroni/urbackup-server` 2.5.37, cliente `uroni/urbackup-client` 2.5.31):
inicio de sesión con y sin usuarios, una copia que se completa, una que falla,
una copia iniciada desde la integración, un cliente desconectado. Aún no
probada en un Gladys real: sus comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-urbackup/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un servidor UrBackup accesible desde la máquina de Gladys, con su interfaz
  web (puerto 55414 por defecto).
- Un usuario de esa interfaz web (**Ajustes → Usuarios**): el admin, o mejor
  un usuario dedicado con los permisos `status`, `progress`, `lastacts`,
  `logs` y `start_backup` (este último solo para iniciar copias desde
  Gladys). Un servidor sin ningún usuario acepta a cualquiera: la integración
  funciona entonces sin contraseña, pero proteja su servidor.

La integración lee UrBackup cada 5 minutos por defecto (cada 30 segundos
durante una copia): tres peticiones ligeras en su propia red.

## Primeros pasos

### 1. Preparar el servidor UrBackup

En la interfaz web de UrBackup, **Ajustes → Usuarios → Crear usuario**: un
nombre (`gladys` por ejemplo), una contraseña y los permisos indicados arriba.
Con la cuenta admin, no hay nada que hacer.

### 2. Configurar la integración

En Gladys, **Integraciones → UrBackup → Configuración**:

- **Dirección de UrBackup**: `http://192.168.1.2:55414` por ejemplo. Una
  dirección sola (`192.168.1.2`) equivale a `http://` en el puerto 55414; una
  dirección copiada del navegador también sirve. Detrás de un proxy inverso,
  su dirección `https://` (con un certificado válido).
- **Usuario** y **Contraseña**: el usuario de la interfaz web.
- **Intervalo de actualización**: 1, 5 (por defecto) o 15 minutos.
- **Con retraso tras**: cuándo un cliente sin copia correcta pasa a tener
  retraso. _Automático_ (por defecto) sigue a UrBackup: un cliente tiene
  retraso cuando UrBackup ya no marca sus copias de archivos como OK (ninguna
  copia en el intervalo de sus ajustes, el de la incremental por defecto). O un
  plazo fijo, de 12 horas a una semana, desde su última copia correcta, de
  archivos o de imagen.
- **Permitir iniciar copias**: permite que funcione la acción de escena
  «Iniciar una copia de archivos». Desactívelo si nadie debe iniciar una copia
  desde Gladys.
- **Idioma de los nombres**: idioma de los nombres de las funciones, de los
  estados y de los resultados de escena.

**Probar la conexión** lee UrBackup y resume: el número de clientes, en
línea, fallidos y con retraso.

### 3. Añadir los clientes

En la pestaña **Descubrir**, añada los clientes que quiera seguir, y el
dispositivo «UrBackup» para el servidor. Los disparadores de escena funcionan
para todos los clientes, añadidos o no.

## Los dispositivos

Cada cliente:

| Función                          | Valor                                                |
| -------------------------------- | ---------------------------------------------------- |
| Estado                           | Correcto, Fallido, Con retraso, En curso o Sin copia |
| En línea                         | 1 cuando el cliente está conectado al servidor       |
| Última copia de archivos         | día/mes horas:minutos, «-» si no hay                 |
| Horas desde la copia de archivos | en horas                                             |
| Última copia de imagen           | día/mes horas:minutos, «-» si no hay                 |
| Horas desde la copia de imagen   | en horas                                             |
| Copia en curso                   | 1 mientras se ejecuta una copia de este cliente      |
| Progreso                         | en %, de la copia en curso                           |
| Errores de la última copia       | errores en el registro de su última copia            |

El dispositivo «UrBackup», para el servidor, cuenta:

- **Clientes en línea**;
- **Copias en curso**;
- **Clientes fallidos**;
- **Clientes con retraso**.

Una copia «falla» cuando su registro contiene errores: una copia que UrBackup
no pudo completar, o que terminó con errores. Un cliente desconectado recibe
la insignia «inaccesible» en Gladys. El estado muestra primero lo que requiere
atención: un cliente fallido muestra «Fallido» aunque también tenga retraso.

## Panel

El widget **UrBackup** muestra el número de clientes fallidos, con retraso y
en línea, y después una fila por cliente: fallidos primero, luego con retraso,
en curso, sin copia, correctos, con la última copia (o el progreso de la que
está en curso); un cliente correcto desconectado aparece en gris. Todos los
clientes por defecto, o los elegidos en sus ajustes. El botón **Actualizar**
vuelve a leer UrBackup.

## Escenas

### Disparadores

- **Una copia se completa**: una copia (archivos o imagen) termina sin
  errores. Información: cliente, tipo (archivos, imagen), duración (minutos),
  tamaño transferido.
- **Una copia falla**: una copia termina con errores en su registro.
  Información: cliente, tipo, primer error, errores.
- **Un cliente tiene retraso**: un cliente no ha tenido una copia correcta
  desde hace más que el plazo «Con retraso tras». Una vez, y de nuevo tras un
  nuevo éxito. Información: cliente, horas desde el último éxito, último
  éxito.

Cada disparador puede limitarse a algunos clientes (vacío: todos).

### Acciones

- **Estado de un cliente**: lee el estado de un cliente para las siguientes
  acciones: fallido, con retraso, en línea, el estado en palabras, el cliente,
  el último éxito, horas desde el último éxito (-1 si no hay), y una frase
  lista («laptop-anna: Fallido, última copia 18/10 02:05.»).
- **Iniciar una copia de archivos**: inicia ahora una copia incremental de
  archivos del cliente. Rechazada cuando «Permitir iniciar copias» está
  desactivado, o por UrBackup cuando el cliente está desconectado.

### Ideas de escenas

- **Una copia falla** → enviar un mensaje con el cliente y su primer error,
  tomados de la información del disparador.
- **Un cliente tiene retraso** → avisar con el cliente y las horas desde su
  último éxito: el portátil lleva días sin encenderse.
- Cada domingo a las 10:00 → **Estado de un cliente** → enviar la frase; o
  iniciar una copia de archivos del ordenador de la oficina a las 19:00 con
  **Iniciar una copia de archivos**.

## Solución de problemas

- **«UrBackup no responde»**: compruebe la dirección y el puerto desde la
  máquina de Gladys (`http://…:55414`, el puerto de la interfaz web, no 55413
  ni 55415).
- **«usuario o contraseña rechazados por UrBackup»**: vuelva a introducirlos;
  son los de un usuario de la interfaz web.
- **«a este usuario de UrBackup le falta un permiso»**: dé al usuario los
  permisos `status`, `progress`, `lastacts`, `logs` (y `start_backup`). Sin
  `logs`, los estados se muestran pero no se anuncia ninguna copia completada
  o fallida.
- **«UrBackup no inició la copia»**: el cliente está desconectado, o ya hay
  una copia suya en curso.
- **«UrBackup está actualizando su base de datos»**: tras una actualización
  de UrBackup; espere a que termine.
- **Un cliente nunca tiene retraso**: en _Automático_, un cliente con las
  copias de archivos desactivadas, o nunca copiado, no tiene retraso; elija un
  plazo fijo para las copias de imagen.
- Para ver más, ponga la variable `LOG_LEVEL` de la integración en `debug`.

## Límites

- Un solo servidor UrBackup por integración.
- Una copia se conoce al terminar, por su registro: los disparadores llegan en
  la lectura siguiente (5 minutos por defecto).
- La integración no restaura, borra ni configura copias: las vigila, e inicia
  copias incrementales de archivos si está permitido.
- HTTPS solo con un certificado firmado por una autoridad conocida (un proxy
  inverso).
- Sin relación con UrBackup. Comunique un problema o una idea en
  [las issues](https://github.com/guim31/gladys-urbackup/issues).
