import type { ConceptCopy, UiStrings } from './types.ts';

export const ES_CONCEPTS: Record<string, ConceptCopy> = {
  human: {
    title: 'Tú',
    plain: 'Eres quien tiene el control en la mano — o los dedos sobre el teclado.',
  },
  browser: {
    title: 'Navegador',
    plain:
      'Tu pestaña del navegador convierte lo que presionas en una serie de comandos de manejo.',
  },
  'cloud-relay': {
    title: 'Relevo de Cloudflare',
    plain:
      'Un pequeño servidor siempre encendido en la nube pasa tus comandos al robot — y solo los tuyos, de nadie más.',
  },
  robot: {
    title: 'Robot',
    plain: 'El robot verifica que lo que llegó tenga sentido, y recién entonces mueve las ruedas.',
  },
  'input-device': {
    title: 'Dispositivo de entrada',
    plain:
      'Lo que tocas para manejar: un teclado, un control de videojuegos, o botones en pantalla.',
    technical:
      'Conviven tres fuentes de entrada: teclado, Gamepad API y pantalla táctil. Solo una maneja a la vez (ver Propiedad de la entrada).',
  },
  'keyboard-input': {
    title: 'Entrada de teclado',
    plain:
      'W/A/S/D o las flechas manejan; Espacio detiene; Q/E abren y cierran la pinza; Z arma/desarma.',
    technical:
      'listenKeyboard() traduce KeyboardEvent.code a una KeyAction, mantiene un set de teclas presionadas, y calcula throttle/steering cancelando teclas opuestas (adelante+atrás = 0). Escribir en un campo de formulario queda excluido, para que la página nunca robe teclas de una caja de texto.',
    why: 'El teclado permite que cualquiera pruebe o haga una demo de RoveLink con solo una laptop — sin necesitar un control físico.',
    failure:
      'Si la pestaña pierde el foco o pasa a segundo plano con una tecla presionada, RoveLink suelta todas las teclas de inmediato (blur / visibilitychange) — una tecla presionada nunca puede seguir manejando desde una pestaña sin foco.',
    tryIt: 'Entra al laboratorio y mantén presionada W — mira cómo se enciende el pipeline abajo.',
  },
  'gamepad-input': {
    title: 'Control (Gamepad API)',
    plain: 'Un control USB/Bluetooth real, leído directamente por el navegador — sin plugins.',
    technical:
      'listenGamepad() muestrea navigator.getGamepads() en cada requestAnimationFrame, compara los ejes/botones crudos contra el cuadro anterior, y solo publica cuando algo realmente cambió — un stick quieto no genera eventos.',
    why: 'Muestrear en rAF y comparar evita inundar el resto del pipeline con 60 lecturas idénticas por segundo cuando el stick no se mueve.',
    tryIt:
      'Conecta un control y mueve el stick — el laboratorio muestra los valores de ejes y botones en vivo.',
  },
  'touch-input': {
    title: 'Controles táctiles',
    plain:
      'Botones en pantalla para manejar desde un teléfono o tablet, sostenidos igual que una tecla.',
    technical:
      'pointerdown/pointerup sobre los botones en pantalla fijan los mismos ejes de throttle/steering que el teclado, capturados por puntero para que un dedo que se resbala del botón igual lo suelte correctamente.',
  },
  'input-ownership': {
    title: 'Propiedad de la entrada',
    plain:
      'Solo una fuente de entrada maneja a la vez, así que los comandos del teclado y del control nunca se suman entre sí.',
    technical:
      'InputOwnership sigue exactamente una fuente activa (keyboard | touch | gamepad). Cada fuente reclama la propiedad con su propia regla de "actividad significativa" — una tecla presionada, un stick que cruza su zona muerta, un toque en pantalla — nunca un orden de prioridad fijo. Solo los ejes/pinza de la fuente activa llegan a ControlEngine.',
    why: 'Sin una única propiedad, una lectura suelta del control y una tecla presionada podrían sumarse en un throttle inesperado e impredecible.',
    alternatives: [
      'Sumar todas las fuentes activas (rechazado — impredecible, e inseguro si dos fuentes no coinciden en dirección).',
      'Lista de prioridad fija, p. ej. el control siempre gana (rechazado — sorprende cuando vuelves a tomar el teclado).',
    ],
    tryIt:
      'Mantén una tecla presionada y luego toca el panel en pantalla — observa el cambio de propiedad.',
  },
  'controller-profile': {
    title: 'Perfil de control',
    plain: 'Un preset con nombre que decide qué significa cada botón y stick — Racing o Stick.',
    technical:
      'Un ControllerProfile es datos, no código: el mapeo de throttle/steering, la zona muerta y cada asignación de botón. evaluateProfile() convierte los valores semánticos crudos en la misma forma GamepadInput que ya espera el resto del pipeline. Armar/Desarmar/pinza/parada de emergencia siempre son un solo ButtonControl, nunca un eje — un stick analógico literalmente no se puede conectar para armar el robot.',
    why: 'Los perfiles basados en datos permiten que el operador elija — o eventualmente personalice — las asignaciones sin ramificar código por cada tipo de control.',
    alternatives: [
      'Custom: clonar un preset y editarlo (validado al cargar por profile-validate.ts, ya que localStorage es entrada no confiable).',
    ],
    tryIt:
      'El perfil Racing está activo por defecto: R2/L2 para throttle, stick izquierdo para dirección.',
  },
  'control-engine': {
    title: 'ControlEngine',
    plain:
      'ControlEngine guarda lo que el navegador quiere que el robot esté haciendo ahora mismo.',
    technical:
      'Guarda un único ControlState (throttle, steering, pinza, armado) — nunca una cola. Cada escritura reemplaza el valor anterior (gana el estado más reciente); normalizeState() recorta los ejes a -1..1 y rechaza cualquier dato malformado antes de que se vuelva estado. Los listeners solo se notifican pasado un pequeño umbral, para no re-renderizar por el ruido analógico del stick.',
    why: 'Una cola permitiría que comandos viejos se reproduzcan después de que el operador ya cambió de opinión — el robot solo debe actuar sobre "qué quiero ahora mismo", nunca sobre un historial de lo presionado.',
    tryIt: 'Observa este panel actualizarse en vivo mientras manejas en el laboratorio de abajo.',
  },
  'control-sender': {
    title: 'ControlSender',
    plain: 'Decide cuándo realmente vale la pena enviar una actualización por la red.',
    technical:
      'Envuelve decideSend() (ver Ritmo de envío) contra un RobotTransport: ante cada cambio de ControlEngine, envía de inmediato, espera al siguiente tick limitado, o no hace nada. Un heartbeat por setInterval reenvía el estado actual periódicamente para que el watchdog TTL del vehículo nunca expire mientras el operador mantiene el stick quieto.',
    why: 'Enviar 60 paquetes idénticos por segundo con el stick centrado desperdiciaría ancho de banda y complicaría razonar sobre el enlace.',
    failure:
      'Al reconectar, reset() borra la línea base del ritmo para que el primer estado tras reconectar se envíe de inmediato, sin esperar a la siguiente ventana limitada.',
  },
  rhythm: {
    title: 'Ritmo de envío',
    plain:
      'La regla de cada cuánto hablarle al robot: al instante ante un cambio real, con regularidad en lo demás, y nunca por nada.',
    technical:
      'decideSend() devuelve immediate (armar/desarmar, cambio de pinza, parada, o pasar a inactivo), rate (un cambio de eje significativo, limitado a hzMax), heartbeat (inactivo/sostenido, reenviado cada heartbeatMs para alimentar el watchdog TTL), o skip.',
    why: 'heartbeatMs debe quedar cómodamente por debajo del TTL del frame (CONTROL_TTL_MS del protocolo) — de lo contrario, el jitter normal de la red, no una desconexión real, dispararía el watchdog.',
    tryIt:
      'Mantén el stick quieto y observa la insignia de decisión alternar entre rate y heartbeat.',
  },
  'websocket-transport': {
    title: 'Transporte WebSocket',
    plain: 'El tubo siempre abierto entre tu navegador y el relevo en la nube del robot.',
    technical:
      'WebSocketTransport es dueño del socket en vivo: conectar/reconectar, codificar los ControlFrame salientes, y decodificar los RemoteMessage entrantes en eventos tipados que consume el resto de la app (presencia de sala, telemetría, RTT, confirmaciones de control).',
  },
  'control-protocol': {
    title: 'Protocolo de control',
    plain: 'La forma exacta de un mensaje de manejo — qué campos tiene y qué significan.',
    technical:
      'Un sobre JSON versionado (protocol.ts). Un ControlFrame lleva seq, sentAt, ttlMs, throttle, steering, gripper y armed. Tampoco hay cola a nivel de protocolo: gana el seq más alto (isNewerFrame) y uno viejo simplemente se descarta, nunca se reproduce.',
    why: 'Versionar en v permite que el formato evolucione sin romper el firmware que ya está grabado y desplegado en el campo.',
    safetyImpact:
      'ttlMs viaja dentro del propio frame, así el watchdog del receptor no depende de un timeout configurado por separado que deba coincidir con la suposición del emisor.',
  },
  'control-relay': {
    title: 'Relevo (Cloudflare Worker)',
    plain: 'Enruta tus comandos al robot correcto y verifica que tengas permiso para manejarlo.',
    technical:
      'Un Cloudflare Worker que autentica y enruta cada socket hacia el Durable Object de sala de su robotId (ver robot-room). No guarda estado de manejo ni mantiene cola: un frame que no puede entregarse de inmediato simplemente desaparece, porque uno más nuevo lo reemplazaría de todas formas.',
  },
  'robot-room': {
    title: 'RobotRoom (Durable Object)',
    plain:
      'El proceso específico en la nube asignado a tu robot — es lo que realmente reenvía tus comandos.',
    technical:
      'Una instancia de Durable Object RobotRoom por robotId, usando la WebSocket Hibernation API para poder dormir entre paquetes sin cerrar la conexión. Exige un único controlador y un único dispositivo activos por sala, marca cada frame reenviado con la sesión de control autoritativa, y degrada/expulsa sockets obsoletos en un barrido periódico por alarma.',
    why: 'La hibernación hace que el tiempo inactivo entre paquetes de control no cueste nada — la sala no necesita mantenerse "caliente" solo por sostener un socket abierto.',
    alternatives: [
      'Un Worker sin estado con una base de datos externa para presencia (rechazado — un Durable Object da un único dueño autoritativo en memoria por robot, sin condiciones de carrera entre solicitudes concurrentes).',
    ],
  },
  'control-session': {
    title: 'Sesión de control',
    plain:
      'Un ID nuevo que el relevo entrega cada vez que un control se conecta, así un comando viejo y demorado nunca puede colarse y pisar uno más nuevo.',
    technical:
      'Se genera del lado del servidor (crypto.randomUUID()) en el momento en que se acepta un registro de controlador — nunca lo provee el cliente. Se marca en cada ControlFrame reenviado desde Attachment.controlSessionId, y se envía al dispositivo como un mensaje explícito controller.session antes de que pueda llegar cualquier frame de esa sesión.',
    why: 'Los números de secuencia por sí solos solo ordenan frames dentro de una misma conexión; una reconexión necesita una forma de decir "esto es una vida nueva del controlador" que un frame viejo y demorado nunca pueda falsificar.',
    safetyImpact:
      'Un frame demorado que lleva un id de sesión viejo es descartado directamente por el firmware (ver Validación de firmware) — nunca puede retroceder la sesión activa del robot.',
  },
  'firmware-transport': {
    title: 'Transporte del firmware',
    plain: 'La propia conexión del robot de vuelta al relevo en la nube.',
    technical:
      'Un cliente WebSocket Secure (WSS) en el ESP32 que decodifica RemoteMessage y los despacha a la capa de control (onControlReceived, onSessionChanged, onEmergencyStopReceived) — la lógica de control nunca toca el cliente de red directamente.',
  },
  'firmware-control': {
    title: 'Validación del firmware',
    plain:
      'Antes de mover algo, el robot verifica dos veces: ¿es realmente el controlador actual, es este comando más nuevo que el último, y es seguro armar?',
    technical:
      'applyControlFrame() rechaza un frame directamente si su id de sesión no coincide con activeSession, o si seq <= lastSeq (obsoleto/duplicado/desordenado). Una sesión recién cambiada además exige un frame explícito armed=false para establecer su "línea base desarmada" antes de que se honre cualquier frame armed=true — la UI del operador podría haber dicho armado un instante antes de que cambiara la sesión.',
    why: 'No confiar en que el primer frame de una sesión nueva venga armado elimina toda una clase de errores de movimiento accidental al reconectar.',
    safetyImpact:
      'Un watchdog de pérdida de enlace (watchTtl) fuerza el estado seguro de forma independiente si no llegó ningún frame aceptado dentro de CONTROL_TTL_MS, sin importar el estado de sesión/secuencia.',
    tryIt:
      'Corre el experimento de Sesión y secuencia para ver, en vivo, cómo se descarta un frame de una sesión obsoleta.',
  },
  'differential-mix': {
    title: 'Mezcla diferencial',
    plain: 'Convierte "qué tan rápido" y "hacia dónde" en dos números separados, uno por rueda.',
    technical:
      'differentialMix(throttle, steering) = { left: throttle + steering, right: throttle - steering }, cada uno recortado a -1..1. Esta misma función se comparte entre protocol/src/mix.ts y (como applyMotors) el firmware — el panel y el robot calculan el resultado idéntico, no una aproximación parecida.',
    why: 'Una función pura compartida permite que el panel muestre exactamente lo que hará el robot, sin desvío entre "lo que predice la UI" y "lo que realmente pasa".',
  },
  'robot-hardware': {
    title: 'Hardware del robot',
    plain:
      'Un rover genérico de dos ruedas — no el chasis específico de RoveLink, solo lo necesario para mostrar cómo se comporta la tracción diferencial.',
    technical:
      'RobotHardware es una abstracción con dos implementaciones elegidas en tiempo de compilación: SimulatedHardware (una placa de prueba ESP32-S3) y RealHardware (el auto físico). La lógica de control solo llama a hwApplyMotors/hwStopMotors/hwApplyGripper — nunca toca GPIO directamente.',
  },
  motors: {
    title: 'Motores',
    plain:
      'Las ruedas realmente girando — una potencia por debajo de un mínimo pequeño no las mueve en absoluto.',
    technical:
      'wheelPwm(value) convierte una magnitud recortada -1..1 en el byte PWM que el firmware escribe en ENA/ENB, escalado desde PWM_MIN (el mínimo que vence la fricción estática del motor) hasta PWM_MAX. Por debajo de MOTOR_THRESHOLD el motor se deja sin energizar en lugar de zumbar con un PWM demasiado bajo para moverlo.',
  },
  'control-ack': {
    title: 'Confirmación de control (ACK)',
    plain:
      'El robot le dice al navegador "sí, ya hice eso" — prueba de acción, no solo prueba de que el mensaje llegó.',
    technical:
      'El firmware lo envía solo después de que un frame pasa la validación de sesión/secuencia y su estado resultante ya fue aplicado — nunca para un frame rechazado. El navegador lo correlaciona contra una marca de tiempo de envío pendiente rastreada localmente (PendingAckTracker) para calcular el RTT de control, mantenido deliberadamente separado del RTT del relevo (un simple ping/pong al borde).',
    why: 'El RTT del relevo solo prueba que el camino de red hacia Cloudflare es rápido; el ACK de control es la única señal que prueba que el robot físico realmente hizo algo, por eso nunca se combinan en un solo número.',
  },
};

export const ES_UI: UiStrings = {
  levels: { plain: 'Concepto', technical: 'Detalles técnicos', code: 'Código fuente' },
  passport: {
    what: 'Qué es',
    why: 'Por qué este diseño',
    plain: 'Concepto',
    technical: 'Detalles técnicos',
    advantages: 'Ventajas',
    disadvantages: 'Desventajas',
    alternatives: 'Alternativas consideradas',
    tradeoffs: 'Compromisos',
    failure: 'Modo de falla',
    safetyImpact: 'Impacto en seguridad',
    tests: 'Pruebas',
    tryIt: 'Pruébalo',
    source: 'FUENTE',
    test: 'PRUEBA',
    viewSource: 'Ver código fuente',
    viewTest: 'Ver prueba',
    close: 'Cerrar',
  },
  facts: {
    implemented: 'IMPLEMENTADO',
    rationale: 'JUSTIFICACIÓN',
    alternative: 'ALTERNATIVA',
    simulation: 'SIMULACIÓN',
    measured: 'MEDIDO',
  },
  explorer: {
    search: 'Buscar un concepto…',
    resetLayout: 'Restablecer diseño',
    resetView: 'Restablecer vista',
    fit: 'Ajustar',
    nodeList: 'Todos los conceptos',
    upstream: 'Alimenta a esto',
    downstream: 'Esto alimenta a',
    noSelection: 'Selecciona un nodo para ver qué hace, por qué existe, y el código real detrás.',
  },
  story: {
    title: 'Flujo de control',
    previous: 'Anterior',
    next: 'Siguiente',
    play: 'Reproducir',
    pause: 'Pausar',
    step: 'Paso',
    of: 'de',
  },
  lab: {
    simulation: 'SIMULACIÓN',
    connected: 'conectado',
    disconnected: 'desconectado',
    noGamepad: 'No se detectó ningún control — conecta uno y presiona un botón.',
    experimentValues: 'VALORES DEL EXPERIMENTO',
    latency: 'latencia',
    resetDefaults: 'Restablecer valores de RoveLink',
    cutConnection: 'Cortar conexión',
    restoreConnection: 'Restaurar conexión',
    reconnectController: 'Reconectar control',
    emergencyStop: 'Parada de emergencia',
    stages: {
      input: 'ENTRADA',
      ownership: 'PROPIEDAD',
      profile: 'PERFIL',
      engine: 'CONTROLENGINE',
      sender: 'CONTROLSENDER',
      frame: 'FRAME DE CONTROL',
      relay: 'RELEVO (SIM)',
      firmware: 'FIRMWARE (SIM)',
      mix: 'MEZCLA DIFERENCIAL',
      ack: 'ACK',
      rtt: 'RTT DE CONTROL (SIM)',
    },
  },
};
