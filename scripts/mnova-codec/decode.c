#include <openjpeg.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
typedef struct {unsigned char*p;size_t n,at;} Buffer;
static OPJ_SIZE_T readmem(void*p,OPJ_SIZE_T n,void*u){Buffer*b=u;if(b->at>=b->n)return (OPJ_SIZE_T)-1;if(n>b->n-b->at)n=b->n-b->at;memcpy(p,b->p+b->at,n);b->at+=n;return n;}
static OPJ_OFF_T skipmem(OPJ_OFF_T n,void*u){Buffer*b=u;if(n<0 || (uint64_t)n>b->n-b->at)return -1;b->at+=n;return n;}
static OPJ_BOOL seekmem(OPJ_OFF_T n,void*u){Buffer*b=u;if(n<0 || (uint64_t)n>b->n)return 0;b->at=n;return 1;}
static void silent(const char*m,void*u){}
float* decode(unsigned char*p,unsigned n,unsigned expected){
 Buffer b={p,n,0};opj_image_t*im=NULL;float*out=NULL;
 opj_codec_t*c=opj_create_decompress(OPJ_CODEC_J2K);opj_stream_t*s=opj_stream_default_create(OPJ_TRUE);
 if(!c||!s)goto end;
 opj_set_error_handler(c,silent,NULL);opj_set_warning_handler(c,silent,NULL);opj_set_info_handler(c,silent,NULL);
 opj_dparameters_t params;opj_set_default_decoder_parameters(&params);if(!opj_setup_decoder(c,&params))goto end;
 opj_stream_set_user_data(s,&b,NULL);opj_stream_set_user_data_length(s,n);opj_stream_set_read_function(s,readmem);opj_stream_set_skip_function(s,skipmem);opj_stream_set_seek_function(s,seekmem);
 if(!opj_read_header(s,c,&im)||im->numcomps!=1)goto end;
 opj_image_comp_t*t=&im->comps[0];if((uint64_t)t->w*t->h!=expected||expected>4194304||t->prec!=28||t->sgnd)goto end;
 if(!opj_decode(c,s,im)||!opj_end_decompress(c,s))goto end;
 out=malloc(expected*4);if(!out)goto end;
 for(unsigned i=0;i<expected;i++)out[i]=(float)((int64_t)t->data[i]-134217728)/268435456.0f;
end: if(im)opj_image_destroy(im);if(s)opj_stream_destroy(s);if(c)opj_destroy_codec(c);return out;
}
