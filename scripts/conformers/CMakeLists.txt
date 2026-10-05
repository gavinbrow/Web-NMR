add_executable(WebNMRConformers conformers.cpp)
target_link_libraries(WebNMRConformers DistGeomHelpers ForceFieldHelpers FileParsers SmilesParse GraphMol)
target_link_options(WebNMRConformers PRIVATE --bind -fwasm-exceptions -sUSE_ZLIB=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1GB -sSTACK_SIZE=2MB -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=initConformers -sENVIRONMENT=web,worker,node -sFILESYSTEM=0)
set_target_properties(WebNMRConformers PROPERTIES SUFFIX ".mjs")
